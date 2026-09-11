#!/usr/bin/env node
/**
 * agent-bridge — puente local multi-agente: la app web despacha, el agente
 * (ZCode o Claude Code) ejecuta.
 *
 * Daemon suscrito REACTIVAMENTE a la cola de Convex (WebSocket). Cuando Cris
 * crea una tarea con ejecutor despachable (zcode/claude):
 *   1. Valida la carpeta destino.
 *   2. Reclama la tarea (claimTask → abre corrida) y arma el prompt empaquetado.
 *   3. Lanza el CLI headless del agente (agents/<agente>.mjs decide cómo).
 *   4. Actividad EN VIVO → la app muestra qué hace en tiempo real (tailer del
 *      rollout en zcode; eventos stream-json en claude).
 *   5. Watchdog: corrida sin actividad >STALL_MS → "posible atasco"; proceso
 *      terminado sin reporte → reporta el despachador.
 *   6. Al terminar: vincula la sesión (resume para seguimientos) y libera slot.
 *
 * Concurrencia por AGENTE (lanes independientes):
 *  - zcode: modelo default del config → hasta MAX_PARALLEL_DEFAULT en paralelo;
 *    modelo distinto exige swap global → exclusivo entre corridas zcode.
 *  - claude: modelo por flag → hasta MAX_PARALLEL_CLAUDE, sin swap.
 *  Corridas zcode y claude conviven sin pisarse.
 * Instancia única por lockfile (.bridge.lock).
 *
 * Arranque: npm run agent-bridge  ·  con auto-restart: npm run agent-bridge:daemon
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexClient } from "convex/browser";
import {
  CONVEX_URL,
  MAX_PARALLEL_CLAUDE,
  NUDGE_MS,
  assertConfig,
  claudeWarnings,
} from "./config.mjs";
import { getToken, q, m } from "./auth.mjs";
import { restoreOrphanSwap } from "./models.mjs";
import {
  buildPrompt,
  buildRedirectPrompt,
  buildPlanPrompt,
  buildCorreoPrompt,
  parsePlanBlock,
  parsePlanQuestion,
} from "./prompts.mjs";
import { notifyAgent } from "./notify.mjs";
import { adapterFor } from "./agents/index.mjs";
import { mkdirSync } from "node:fs";

const RUN_TIMEOUT_MS = Number(process.env.AGENT_RUN_TIMEOUT_MS || 60 * 60 * 1000);
const MAX_PARALLEL_DEFAULT = Number(process.env.MAX_PARALLEL_DEFAULT || 2);
const STALL_MS = Number(process.env.AGENT_STALL_MS || 10 * 60 * 1000);
const BRIDGE_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOCK_FILE = path.join(BRIDGE_DIR, ".bridge.lock");

/** Corridas activas en este proceso: taskId → info de la corrida. */
const activeRuns = new Map();
/** Tareas ya reservadas por este pump (entre claim y arranque real). */
const reserving = new Set();
let defaultModel = "";
let queueDepth = 0;
/** Token de sesión para el env de las corridas (se renueva a diario). */
let _tokenForChild = "";

function log(...a) {  console.log(`[${new Date().toLocaleTimeString()}]`, ...a);
}

/** Instancia única: lockfile con pid vivo (evita dos puentes pisándose). */
function acquireLock() {
  try {
    if (existsSync(LOCK_FILE)) {
      const prev = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
      try {
        process.kill(prev.pid, 0);
        console.error(
          `Ya hay un puente corriendo (pid ${prev.pid}, desde ${new Date(prev.startedAt).toLocaleTimeString()}). Cerrá esa instancia o borrá agent-bridge/.bridge.lock.`,
        );
        process.exit(1);
      } catch {
        // pid muerto → lock huérfano, lo reclamamos
      }
    }
  } catch {
    // lock ilegible → lo sobreescribimos
  }
  writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
}

function releaseLock() {
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    // nada que liberar
  }
}

/**
 * ¿Puede arrancar otra corrida de este agente ahora? Por lane:
 *  - claude: tope MAX_PARALLEL_CLAUDE (sin swap, sin exclusividad).
 *  - zcode: la regla del swap global — si hay corridas zcode activas, todas
 *    deben ser del default y la nueva también (hasta el tope); un modelo
 *    distinto exige exclusividad total DENTRO de la lane zcode.
 */
function canDispatch(task, adapter) {
  const lane = [...activeRuns.values()].filter((r) => r.agent === adapter.id);
  if (adapter.id === "claude") {
    return lane.length < MAX_PARALLEL_CLAUDE;
  }
  const effective = adapter.effectiveModel(task, defaultModel);
  if (lane.length === 0) return true;
  if (effective !== defaultModel) return false;
  const allDefault = lane.every((r) => r.effectiveModel === defaultModel);
  return allDefault && lane.length < MAX_PARALLEL_DEFAULT;
}

/**
 * Corridas huérfanas: tareas en despachada/trabajando que NO están activas
 * acá (p.ej. el puente se reinició a mitad de corrida). Se marcan error para
 * que Cris las re-despache con un clic — nunca se relanzan solas.
 */
async function recoverStuck() {
  try {
    const overview = await q("agent:agentOverview");
    const stuck = [...(overview?.working ?? [])].filter(
      (t) => !activeRuns.has(t._id) && !reserving.has(t._id),
    );
    for (const t of stuck) {
      // Gracia para corridas recientes de otra instancia que pueda estar viva.
      if (Date.now() - t.updatedAt < 5 * 60 * 1000) continue;
      await m("agent:agentReport", {
        taskId: t._id,
        state: "error",
        error:
          "Corrida interrumpida: el puente se reinició a mitad de la ejecución. Respondé acá para que reintente.",
        watchdog: true,
      });
      log(`♻ corrida huérfana marcada error: ${t.title}`);
    }
  } catch (e) {
    log("recoverStuck:", e.message);
  }
}

/** Sincroniza el catálogo de modelos de cada agente → picker de la app. */
async function syncModels() {
  for (const adapter of new Set([adapterFor("zcode"), adapterFor("claude")])) {
    try {
      const { models, default: def } = adapter.modelCatalog();
      if (!models.length && !def) continue;
      await m("agent:syncModels", { models, default: def, agent: adapter.id });
      log(`modelos ${adapter.id} sincronizados: ${models.length} (default ${def})`);
    } catch (e) {
      log(`syncModels ${adapter.id}:`, e.message);
    }
  }
}

// ===== DESPACHO =====

async function dispatchTask(entry) {
  const taskId = entry.task._id;
  const adapter = adapterFor(entry.task.executor);
  const run = {
    taskId,
    agent: adapter.id,
    title: entry.task.title,
    effectiveModel: adapter.effectiveModel(entry.task, defaultModel),
    spawnedAt: Date.now(),
    lastActivityAt: Date.now(),
    stalledNotified: false,
  };
  activeRuns.set(taskId, run);
  try {
    await dispatchTaskInner(entry, run, adapter);
  } finally {
    activeRuns.delete(taskId);
    // Un slot liberado puede habilitar tareas en cola.
    pump().catch(() => {});
  }
}

async function dispatchTaskInner({ task, workspace }, run, adapter) {
  const taskId = task._id;
  const notifyMode = task.notifyWhatsapp ?? "off";

  // Contrato operativo vigente (editable por Cris en la app): fresco en cada
  // despacho, así una edición aplica sin reiniciar el puente.
  const contract = await q("agent:getContract").catch(() => null);

  // Carpeta de trabajo. Tareas de CORREO: el agente no escribe — corre en la
  // primera carpeta de CONTEXTO si existe, o en una neutra del puente.
  let folder = task.workspacePath || workspace?.path || "";
  if (task.taskType === "correo") {
    const ctxFolder = task.contextPaths?.carpetas?.[0];
    folder =
      ctxFolder && existsSync(ctxFolder)
        ? ctxFolder
        : path.join(BRIDGE_DIR, "workspace-correo");
    try {
      mkdirSync(folder, { recursive: true });
    } catch {}
  }

  // Cuerpo COMPLETO del correo de origen (para el prompt de respuesta).
  const correo = task.correoId
    ? await q("correos:correoDeTarea", { taskId }).catch(() => null)
    : null;

  // 1) Carpeta en disco: sin carpeta el agente no sabe dónde trabajar →
  //    pregunta (no error): Cris elige la carpeta en la app y re-encola.
  if (!folder || !existsSync(folder)) {
    await m("agent:agentReport", {
      taskId,
      state: "pregunta",
      question: folder
        ? `La carpeta destino no existe en este PC: ${folder}. Corrígela en la app y responde aquí para reintentar.`
        : "La tarea no tiene carpeta destino. Elígela al editar la tarea y responde aquí para que reintente.",
      error: folder ? `carpeta inexistente: ${folder}` : "sin carpeta destino",
    }).catch((e) => log("report pregunta falló:", e.message));
    return;
  }

  // 2) Resume REAL de la sesión del agente: si la tarea tiene agentSessionId
  //    y la sesión sigue viva en el motor (db.sqlite para zcode, JSONL para
  //    claude), el agente retoma TODO su contexto. Va ANTES del claim: el
  //    claim también lo usa, y declararlo después era un TDZ que dejaba la
  //    tarea pegada en encolada para siempre.
  const sessAlive = task.agentSessionId
    ? adapter.sessionAlive(task.agentSessionId)
    : false;

  // 3) Reclamar (abre la corrida y entrega el followUp pendiente de Cris).
  let runId, followUp;
  try {
    const claimed = await m("agent:claimTask", {
      taskId,
      // resumed = la corrida RETOMA una sesión previa viva,
      // no solo "la tarea tenía un sessionId guardado".
      resumed: sessAlive,
      workspacePath: folder,
    });
    runId = claimed.runId;
    followUp = claimed.followUp;
  } catch (e) {
    log(`claim ${taskId}: ${e.message}`);
    return;
  }
  run.runId = runId;

  // Corrida REANUDADA (interrumpión/reinicio/redirección previa): avisar una
  // sola vez para que la renumeración de pasos del WhatsApp no confunda.
  if (sessAlive && notifyMode === "periodica") {
    notifyAgent(notifyMode, "reanudada", {
      title: task.title,
      executor: task.executor,
    }).catch(() => {});
  }

  // Modo plan: sin plan aprobado, esta corrida es la FASE DE PLANIFICACIÓN —
  // se lanza con --mode plan (solo lectura REAL del CLI) y el plan se cosecha
  // del stdout al terminar (el agente no puede llamar a report.mjs ahí).
  const planning = task.planMode === true && task.planApproved !== true;

  const prompt = planning
    ? buildPlanPrompt({
        task,
        workspacePath: folder,
        runId,
        followUp,
        contract,
        agentLabel: adapter.label,
      })
    : task.taskType === "correo" && correo
      ? buildCorreoPrompt({
          task,
          runId,
          followUp,
          correo,
          agentLabel: adapter.label,
        })
      : buildPrompt({
          task,
          workspacePath: folder,
          runId,
          followUp,
          resumed: !!task.agentSessionId,
          contract,
          agentLabel: adapter.label,
        });
  const needsSwap = adapter.needsSwap(run.effectiveModel, defaultModel);

  log(
    `▶ despachando "${task.title}" [${adapter.label} · ${task.taskType}/${task.autonomy}/${run.effectiveModel.split("/").pop() || "default"}${planning ? " · MODO PLAN" : ""}] → ${folder}` +
      (activeRuns.size > 1 ? ` (paralela, ${activeRuns.size} activas)` : ""),
  );

  // 4) Spawn vía adaptador. Env compartido: los hooks (Stop/SessionStart de
  //    zcode Y claude) se activan solo con ZCODE_TASK_ID presente.
  const restore = needsSwap ? adapter.swap(run.effectiveModel) : null;
  const childEnv = {
    ...process.env,
    ZCODE_TASK_ID: taskId,
    ZCODE_RUN_ID: runId,
    ZCODE_SESSION_TOKEN: _tokenForChild,
    ZCODE_CONVEX_URL: CONVEX_URL,
  };

  // API que usan los adaptadores para reportar en vivo.
  const liveApi = {
    bindSession: (sessionId) => {
      m("agent:bindSession", { taskId, sessionId, runId }).catch(() => {});
    },
    activity: (text) => {
      m("agent:runActivity", {
        taskId,
        runId,
        activity: text,
      }).catch(() => {});
    },
  };

  /**
   * Un proceso de la corrida. Devuelve {code, err, stdout}. El bucle exterior
   * lo relanza cuando llega una REDIRECCIÓN EN VIVO: mismo runId, misma
   * sesión (--resume), nuevo rumbo (ver handleRedirects).
   */
  const launch = (promptText, resumeId) =>
    new Promise((resolve) => {
      const spec = adapter.buildSpawn({
        prompt: promptText,
        sessionId: resumeId,
        folder,
        autonomy: task.autonomy,
        model: task.model,
        env: childEnv,
        mode: planning ? "plan" : undefined,
      });
      const child = spawn(spec.exe, spec.args, spec.options);
      run.kill = () => child.kill();
      run.childAlive = true;
      // ¿Quedó una redirección encolada mientras no había proceso vivo?
      // Revisar ahora que hay alguien a quien interrumpir.
      void handleRedirects().catch(() => {});
      if (run.tailer) clearInterval(run.tailer);
      run.tailer = adapter.startTailer(run, liveApi);
      // Bind temprano de la sesión (chat disponible mid-run): zcode la busca
      // en db.sqlite por título; claude ya la bindeó vía system/init.
      if (run.sessionWatch) clearInterval(run.sessionWatch);
      run.sessionWatch = adapter.watchSession?.(run, liveApi) ?? null;

      let stdout = "";
      let buf = "";
      child.stdout.on("data", (d) => {
        stdout += d;
        if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000);
        // Líneas completas → eventos en vivo (claude stream-json; zcode --json
        // es un solo objeto al final y pasa por extractResponse igual).
        buf += d;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) adapter.onStdoutLine(run, line, liveApi);
      });
      child.stderr.on("data", (d) => {
        const s = String(d);
        if (s.trim()) log(`  [${adapter.id}] ${s.trim().slice(0, 300)}`);
      });

      const timeout = setTimeout(() => {
        log(`⏱ timeout ${RUN_TIMEOUT_MS / 60000}min — matando corrida "${task.title}"`);
        child.kill();
      }, RUN_TIMEOUT_MS);

      child.on("error", (err) => {
        clearTimeout(timeout);
        run.childAlive = false;
        resolve({ code: -1, err: String(err), stdout });
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        run.childAlive = false;
        if (buf.trim()) adapter.onStdoutLine(run, buf, liveApi);
        resolve({ code, stdout });
      });
    });

  try {
    let promptText = prompt;
    let resumeId = sessAlive ? task.agentSessionId : null;
    let res;
    for (;;) {
      res = await launch(promptText, resumeId);
      // ¿Llegó una redirección en vivo mientras este proceso corría? Retomar
      // la MISMA sesión/corrida con el nuevo rumbo (handleRedirects mató el
      // proceso y dejó la instrucción en run.pendingRedirect).
      if (run.redirected && run.sessionId) {
        const instruction = run.pendingRedirect;
        run.pendingRedirect = "";
        run.redirected = false;
        log(`♻ retomando corrida ${runId} con la redirección en vivo (--resume ${run.sessionId.slice(0, 12)}…)`);
        promptText = buildRedirectPrompt({ task, instruction, runId });
        resumeId = run.sessionId;
        continue;
      }
      break;
    }

    // ===== FASE DE PLANIFICACIÓN: cosechar el plan y esperarlo en la app =====
    // El agente en --mode plan no puede reportar (no ejecuta comandos): el
    // plan viaja en su respuesta final y lo entrega el puente (submitPlan).
    if (planning) {
      const sessionId = adapter.extractSessionId(run, res.stdout);
      if (sessionId) {
        await m("agent:bindSession", { taskId, sessionId, runId }).catch(() => {});
      }
      const response = adapter.extractResponse(res.stdout);
      const parsed = parsePlanBlock(response);
      let submitted = false;
      if (parsed && (parsed.steps.length > 0 || parsed.detail)) {
        try {
          await m("agent:submitPlan", {
            sessionToken: _tokenForChild,
            taskId,
            runId,
            steps: parsed.steps,
            detail: parsed.detail || undefined,
          });
          submitted = true;
        } catch (e) {
          log(`submitPlan ${taskId} falló: ${e.message}`);
        }
      }
      if (submitted) {
        log(
          `📋 plan listo para "${task.title}" (${parsed.steps.length} pasos) — esperando OK de Cris`,
        );
        notifyAgent(notifyMode, "planListo", {
          title: task.title,
          executor: task.executor,
          plan: parsed.steps,
        }).catch(() => {});
      } else {
        // Sin plan utilizable: ¿pregunta de Cris o corrida fallida?
        const question =
          res.code === 0 ? parsePlanQuestion(response) : null;
        await m("agent:agentReport", {
          taskId,
          runId,
          state: question ? "pregunta" : "error",
          ...(question
            ? { question: question.slice(0, 2000) }
            : {
                error: "la fase de planificación no devolvió un plan utilizable",
                summary: response ? response.slice(0, 500) : undefined,
              }),
          exitCode: res.code,
          watchdog: true,
        }).catch((e) => log("report planificación falló:", e.message));
      }
      log(`✔ planificación ${runId} terminada (exit ${res.code})`);
      return;
    }

    // 5) Vincular sesión + watchdog si el agente no reportó.
    const sessionId = adapter.extractSessionId(run, res.stdout);
    if (sessionId) {
      await m("agent:bindSession", { taskId, sessionId, runId }).catch(() => {});
    }
    const runs = await q("agent:runsByTask", { taskId }).catch(() => []);
    const open = (runs || []).some(
      (r) =>
        r.state === "planificando" ||
        r.state === "despachada" ||
        r.state === "trabajando" ||
        r.state === "pregunta",
    );
    if (open) {
      const response = adapter.extractResponse(res.stdout);
      if (res.code === 0) {
        await m("agent:agentReport", {
          taskId,
          runId,
          state: "para-revision",
          summary:
            (response ? `${response}\n\n` : "") +
            "(proceso terminó sin reporte del agente — despachador)",
          exitCode: res.code,
          watchdog: true,
        }).catch((e) => log("watchdog report falló:", e.message));
      } else {
        await m("agent:agentReport", {
          taskId,
          runId,
          state: "error",
          error: `${adapter.id} terminó con código ${res.code}${res.err ? `: ${res.err}` : ""}`,
          summary: response,
          exitCode: res.code,
          watchdog: true,
        }).catch((e) => log("watchdog report falló:", e.message));
      }
    }
    log(`✔ corrida ${runId} terminada (exit ${res.code})`);
  } catch (err) {
    await m("agent:agentReport", {
      taskId,
      runId,
      state: "error",
      error: `el despachador falló: ${err?.message ?? err}`,
    }).catch(() => {});
  } finally {
    if (run.nudge) clearInterval(run.nudge);
    if (run.tailer) clearInterval(run.tailer);
    if (run.sessionWatch) clearInterval(run.sessionWatch);
    if (restore) restore();
  }
}

/**
 * Toma la cola y lanza en paralelo todo lo que la regla de concurrencia
 * permita. Las corridas corren "sueltas" (no await): el pump solo decide quién
 * arranca; la liberación de slots re-dispara el pump en el finally de cada una.
 */
async function pump() {
  let queue;
  try {
    queue = await q("agent:agentQueue");
  } catch (e) {
    log("agentQueue falló:", e.message);
    return;
  }
  queueDepth = queue?.length ?? 0;
  for (const entry of queue ?? []) {
    const id = entry.task._id;
    if (activeRuns.has(id) || reserving.has(id)) continue;
    const adapter = adapterFor(entry.task.executor);
    if (!canDispatch(entry.task, adapter)) continue;
    reserving.add(id);
    void dispatchTask(entry)
      .catch((e) => log("dispatch:", e.message))
      .finally(() => reserving.delete(id));
  }
}

/**
 * Redirecciones EN VIVO: Cris cambió el rumbo de una corrida activa y no puede
 * esperar a que termine (el camino viejo la entregaba en el próximo reporte).
 * Suscripción reactiva a agent:redirectQueue: por cada instrucción sobre una
 * corrida VIVA (proceso arriba + sesión ya bindeada para retomar):
 *   1. La consume (agentReport limpia agentRedirect, fail-once) dejando el
 *      paso "🔄 redirección en vivo: …" en la checklist (visible en el tablero
 *      y en el chat vía tracker).
 *   2. Mata el proceso; el loop de dispatchTaskInner lo detecta y RETOMA la
 *      MISMA sesión (--resume) y la MISMA corrida (mismo runId → report.mjs
 *      sigue alimentando la misma fila) con la instrucción como prompt.
 * Si no hay corrida viva (pregunta/encolada), la instrucción queda para el
 * mecanismo clásico (followUp del próximo despacho).
 */
async function handleRedirects() {
  let items;
  try {
    items = await q("agent:redirectQueue");
  } catch (e) {
    log("redirectQueue falló:", e.message);
    return;
  }
  for (const it of items ?? []) {
    const run = activeRuns.get(it.taskId);
    if (!run || !run.runId) continue;
    if (run.pendingRedirect) continue; // ya hay una en camino
    if (!run.sessionId || !run.childAlive) continue; // nada vivo que interrumpir
    run.pendingRedirect = it.redirect;
    run.lastActivityAt = Date.now();
    log(`🔄 redirección en vivo para "${run.title}": ${it.redirect.slice(0, 90)}`);
    await m("agent:agentReport", {
      taskId: it.taskId,
      runId: run.runId,
      state: "trabajando",
      step: `🔄 redirección en vivo: ${it.redirect.slice(0, 100)}`,
    }).catch((e) => log("report redirección falló:", e.message));
    run.redirected = true;
    run.kill?.();
  }
}

/** Watchdog de atascos + kill de tareas borradas/canceladas + heartbeat rico. */
async function beat() {
  try {
    const now = Date.now();
    for (const run of activeRuns.values()) {
      // ¿Cris borró o canceló la tarea mientras corría? Matar la corrida ya.
      // OJO args: tasks:get espera { id } — con el nombre mal, la validación
      // de Convex falla, el catch devuelve null y mataríamos TODA corrida.
      const t = await q("tasks:get", { id: run.taskId }).catch(() => null);
      if (
        t &&
        (t.deletedAt !== undefined ||
          t.agentState === "cancelada" ||
          t.executor !== run.agent)
      ) {
        log(`✗ "${run.title}" borrada/cancelada/cambiada de agente — matando corrida ${run.runId}`);
        if (run.kill) run.kill();
        continue; // el post-exit watchdog reporta sin efecto sobre la tarea
      }
      const silentFor = now - run.lastActivityAt;
      if (silentFor > STALL_MS && !run.stalledNotified) {
        run.stalledNotified = true;
        await m("agent:runActivity", {
          taskId: run.taskId,
          runId: run.runId,
          activity: "(sin actividad registrada por un rato)",
          stalled: true,
        }).catch(() => {});
        log(`⚠ posible atasco en corrida ${run.runId} (${Math.round(silentFor / 60000)} min sin actividad)`);
      }
    }
    await m("agent:bridgeHeartbeat", {
      state: {
        activeRuns: [...activeRuns.values()].map((r) => ({
          title: r.title ?? "(reservando)",
          elapsedMin: Math.round((now - r.spawnedAt) / 60000),
          model: r.agent === "claude" ? `claude:${r.effectiveModel}` : r.effectiveModel,
          agent: r.agent,
        })),
        queueDepth,
        pid: process.pid,
      },
    });
  } catch (e) {
    // el heartbeat nunca tumba el puente
  }
  await recoverStuck();
}

async function main() {
  const problems = assertConfig();
  if (problems.length) {
    console.error("Configuración incompleta del puente:\n - " + problems.join("\n - "));
    process.exit(1);
  }
  for (const w of claudeWarnings()) console.warn(`⚠ ${w}`);
  acquireLock();
  if (restoreOrphanSwap()) log("swap de modelo huérfano restaurado");

  _tokenForChild = await getToken();
  defaultModel = adapterFor("zcode").modelCatalog().default || "";
  log(`puente activo → ${CONVEX_URL} (default ${defaultModel}, paralelas default: ${MAX_PARALLEL_DEFAULT}, paralelas claude: ${MAX_PARALLEL_CLAUDE})`);

  // Sembrar carpetas por defecto (idempotente) y sincronizar modelos.
  await m("agent:seedWorkspaces").catch((e) => log("seedWorkspaces:", e.message));
  await syncModels().catch((e) => log("syncModels:", e.message));

  const beatTimer = setInterval(() => void beat(), 60_000);
  await beat();

  // Suscripción reactiva: cada cambio de la cola dispara un pump.
  const client = new ConvexClient(CONVEX_URL);
  client.onUpdate(
    "agent:agentQueue",
    { sessionToken: _tokenForChild },
    () => {
      pump().catch((e) => log("pump:", e.message));
    },
  );

  // Redirecciones en vivo: cada instrucción de Cris sobre una corrida activa
  // se entrega AL INSTANTE (interrumpir + retomar con --resume).
  client.onUpdate(
    "agent:redirectQueue",
    { sessionToken: _tokenForChild },
    () => {
      handleRedirects().catch((e) => log("redirects:", e.message));
    },
  );

  // Refrescar el token del env para corridas futuras (30 días; renovamos diario).
  setInterval(async () => {
    try {
      _tokenForChild = await getToken();
    } catch {
      // sigue con el actual hasta que expire
    }
  }, 24 * 60 * 60 * 1000);

  // Arranque: por si había tareas esperando con el puente apagado.
  await pump();

  const stop = () => {
    log("deteniendo puente…");
    clearInterval(beatTimer);
    for (const run of activeRuns.values()) {
      if (run.nudge) clearInterval(run.nudge);
      if (run.tailer) clearInterval(run.tailer);
      if (run.sessionWatch) clearInterval(run.sessionWatch);
      if (run.kill) run.kill();
    }
    client.close();
    releaseLock();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error("puente murió:", err);
  releaseLock();
  process.exit(1);
});
