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
  DEPLOYMENT_TAG,
  MAX_PARALLEL_CLAUDE,
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
import { copiarMaterial } from "./material.mjs";
import { adapterFor } from "./agents/index.mjs";
import { killTree } from "./proc.mjs";
import { mkdirSync } from "node:fs";

const RUN_TIMEOUT_MS = Number(process.env.AGENT_RUN_TIMEOUT_MS || 60 * 60 * 1000);
const MAX_PARALLEL_DEFAULT = Number(process.env.MAX_PARALLEL_DEFAULT || 2);
const STALL_MS = Number(process.env.AGENT_STALL_MS || 10 * 60 * 1000);
const BRIDGE_DIR = path.dirname(fileURLToPath(import.meta.url));
// Candado por deployment: un puente por deployment (prod y dev conviven).
const LOCK_FILE = path.join(BRIDGE_DIR, `.bridge${DEPLOYMENT_TAG}.lock`);

/** Corridas activas en este proceso: taskId → info de la corrida. */
const activeRuns = new Map();
/** Tareas ya reservadas por este pump (entre claim y arranque real). */
const reserving = new Set();
/**
 * Backoff de tareas cuyo claim falló (validación de carpeta/tipo, error de
 * red…): taskId → { until, reason, title }. Sin esto, el finally de cada
 * despacho re-disparaba pump() y un claim que siempre falla entraba en bucle
 * apretado (2286 intentos en 11 min en bridge.log). Se publica en el
 * heartbeat para que la cola de la app explique por qué la tarea espera.
 */
const failedUntil = new Map();
const CLAIM_BACKOFF_MS = 5 * 60 * 1000;
let defaultModel = "";
let queueDepth = 0;
let lastBeatErrorAt = 0;
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
          `Ya hay un puente corriendo (pid ${prev.pid}, desde ${new Date(prev.startedAt).toLocaleTimeString()}). Cierra esa instancia o borra ${path.basename(LOCK_FILE)}.`,
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
          "Corrida interrumpida: el puente se reinició a mitad de la ejecución. Responde aquí para que reintente.",
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
    // Un slot liberado puede habilitar tareas en cola. Si la corrida ni
    // siquiera se reclamó (claim fallido), no re-disparar: la suscripción y
    // el pump de respaldo lo harán, y el backoff evita el bucle apretado.
    if (run.runId) pump().catch(() => {});
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

  // Guía de redacción de Cris (su voz + regla de fidelidad): fresca en cada
  // despacho, así editarla aplica sin reiniciar el puente.
  let guiaCris = "";
  if (task.taskType === "correo") {
    try {
      guiaCris = readFileSync(path.join(BRIDGE_DIR, "guia-correo-cris.md"), "utf8");
    } catch {
      // sin guía: la regla de fidelidad sigue vigente (va en el prompt)
    }
  }

  // 0) Carpeta customizada (gitStrategy solo-local): los adjuntos que Cris
  //    eligió se COPIAN dentro de la carpeta (se crea si no existe — puede
  //    ser nueva) para que la corrida sea autocontenida. Idempotente: nunca
  //    pisa lo que ya está (re-despachos/resumes no re-copian).
  if (task.gitStrategy === "solo-local") {
    // Carpeta propia escrita a mano (sin pasar por el diálogo): se crea en
    // el mismo paso aunque no haya adjuntos — antes solo la creía
    // copiarMaterial y el despacho rebotaba con [sin-carpeta]. Si la ruta es
    // inválida, mkdir falla y el guard del paso 1 la sigue capturando.
    if (!task.workspaceId && folder && !existsSync(folder)) {
      try {
        mkdirSync(folder, { recursive: true });
        log(`📁 carpeta propia creada: ${folder}`);
      } catch (e) {
        log(`⚠ no se pudo crear la carpeta propia (${folder}): ${e.message}`);
      }
    }
    const origenArchivos = task.contextPaths?.archivos ?? [];
    const res = copiarMaterial(folder, origenArchivos);
    if (res.copiados.length)
      log(
        `📎 material copiado a "${folder}": ${res.copiados.map((f) => path.basename(f)).join(", ")}`,
      );
    if (res.saltados.length)
      log(`📎 material ya presente (no se pisa): ${res.saltados.map((f) => path.basename(f)).join(", ")}`);
    for (const f of res.fallidos) log(`⚠ material no copiado: ${f.origen} (${f.error})`);
    // El prompt apunta a las COPIAS dentro de la carpeta, no a los originales.
    if (origenArchivos.length) {
      task = {
        ...task,
        contextPaths: {
          ...task.contextPaths,
          archivos: origenArchivos.map((a) => path.join(folder, path.basename(a))),
        },
      };
    }
  }

  // 1) Carpeta en disco: sin carpeta el agente no sabe dónde trabajar →
  //    pregunta (no error): Cris elige la carpeta en la app y re-encola.
  if (!folder || !existsSync(folder)) {
    // Prefijo estable [sin-carpeta]: el panel lo detecta y ofrece "Editar
    // tarea" + "Reintentar" (escribir la ruta en la respuesta no sirve).
    // force: la tarea sigue en "encolada" (no hay corrida) y la matriz de
    // agentReport ignoraría el reporte.
    log(`📁 "${task.title}": ${folder ? `carpeta inexistente (${folder})` : "sin carpeta destino"} — se le pide a Cris`);
    await m("agent:agentReport", {
      taskId,
      state: "pregunta",
      question: folder
        ? `[sin-carpeta] La carpeta destino no existe en este PC: ${folder}. Edita la tarea y elige una carpeta válida; luego pulsa Reintentar.`
        : "[sin-carpeta] La tarea no tiene carpeta destino. Edita la tarea y elige la carpeta; luego pulsa Reintentar.",
      error: folder ? `carpeta inexistente: ${folder}` : "sin carpeta destino",
      force: true,
    }).catch((e) => log("report pregunta falló:", e.message));
    return;
  }

  // Carpeta final de esta corrida: el bind temprano de sesión (watchSession)
  // la usa para identificar la sesión nueva en db.sqlite por directory.
  run.folder = folder;

  // 2) Resume REAL de la sesión del agente: si la tarea tiene agentSessionId
  //    y la sesión sigue viva en el motor (db.sqlite para zcode, JSONL para
  //    claude), el agente retoma TODO su contexto. Va ANTES del claim: el
  //    claim también lo usa, y declararlo después era un TDZ que dejaba la
  //    tarea pegada en encolada para siempre.
  const sessAlive = task.agentSessionId
    ? adapter.sessionAlive(task.agentSessionId)
    : false;

  // 3) Reclamar (abre la corrida y entrega el followUp pendiente de Cris).
  let runId, followUp, followUpKind;
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
    followUpKind = claimed.followUpKind;
    failedUntil.delete(taskId);
  } catch (e) {
    const raw = String(e?.message ?? e);
    const reason = (raw.match(/Uncaught Error:\s*([^\n]+)/)?.[1] ?? raw.split("\n")[0]).slice(0, 200);
    failedUntil.set(taskId, {
      until: Date.now() + CLAIM_BACKOFF_MS,
      reason,
      title: task.title,
    });
    log(`claim ${taskId} falló (reintento en ${CLAIM_BACKOFF_MS / 60000} min): ${reason}`);
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
          guia: guiaCris,
          agentLabel: adapter.label,
        })
      : buildPrompt({
          task,
          workspacePath: folder,
          runId,
          followUp,
          followUpKind,
          // La sesión REALMENTE retomable (no solo "había un id guardado"):
          // si ya no existe, el prompt no debe decir "retomas tu sesión".
          resumed: sessAlive,
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
    // El despachador cubre el fin de proceso con la respuesta REAL del agente
    // (post-exit, abajo): el hook Stop queda como no-op en sus corridas (antes
    // ganaba siempre con un resumen genérico y sin código de salida).
    HERMES_BRIDGE_POSTEXIT: "1",
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
      // Telemetría: hito de proceso arriba (desde acá corre el CLI; la
      // distancia startedAt→spawn mide armado de prompt + swap de modelo).
      if (!run.spawnReported) {
        run.spawnReported = true;
        m("agent:runPhase", {
          sessionToken: _tokenForChild,
          taskId,
          runId,
          phase: "spawn",
        }).catch(() => {});
      }
      run.kill = () => killTree(child);
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
        killTree(child);
      }, RUN_TIMEOUT_MS);

      let settled = false;
      const settle = (res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        run.childAlive = false;
        if (buf.trim()) adapter.onStdoutLine(run, buf, liveApi);
        buf = "";
        resolve({ ...res, stdout });
      };
      child.on("error", (err) => settle({ code: -1, err: String(err) }));
      child.on("close", (code) => settle({ code }));
      // Si un nieto heredó el stdout, "close" puede no llegar nunca: tras el
      // exit del CLI se da una gracia para drenar la salida y se cierra igual.
      child.on("exit", (code) => {
        setTimeout(() => settle({ code }), 1500).unref?.();
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

    // 5) Vincular sesión + watchdog si el agente no reportó. Se decide por
    //    el estado de la TAREA: solo despachada/trabajando significan "el
    //    proceso terminó sin reporte". Una pregunta abierta, una revisión o
    //    una cancelación ya son resultados y NO se pisan (la mutación aplica
    //    además la matriz de transiciones).
    const sessionId = adapter.extractSessionId(run, res.stdout);
    if (sessionId) {
      await m("agent:bindSession", { taskId, sessionId, runId }).catch(() => {});
    }
    const fresh = await q("tasks:get", { id: taskId }).catch(() => null);
    const open =
      !!fresh &&
      fresh.deletedAt === undefined &&
      (fresh.agentState === "despachada" ||
        fresh.agentState === "trabajando" ||
        fresh.agentState === "iterando");
    if (fresh?.agentState === "pregunta") {
      log(`❓ "${task.title}": el agente dejó una pregunta abierta — sin watchdog`);
    }
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
          // null NO pasa el validador (v.optional exige undefined): sin
          // respuesta del stdout no se manda summary.
          ...(response ? { summary: response } : {}),
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
    const blocked = failedUntil.get(id);
    if (blocked && blocked.until > Date.now()) continue;
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
    // Un ítem malo nunca aborta el resto (antes: un redirect undefined tiraba
    // "reading 'slice'" y las redirecciones de detrás no se entregaban).
    try {
      if (!it?.redirect) continue;
      const run = activeRuns.get(it.taskId);
      if (!run || !run.runId) continue;
      if (run.pendingRedirect) continue; // ya hay una en camino
      if (!run.sessionId || !run.childAlive) continue; // nada vivo que interrumpir
      run.pendingRedirect = it.redirect;
      run.lastActivityAt = Date.now();
      log(`🔄 redirección en vivo para "${run.title}": ${it.redirect.slice(0, 90)}`);
      // force: el puente SABE que el agente retoma (también desde "pregunta").
      await m("agent:agentReport", {
        taskId: it.taskId,
        runId: run.runId,
        state: "trabajando",
        step: `🔄 redirección en vivo: ${it.redirect.slice(0, 100)}`,
        force: true,
      }).catch((e) => log("report redirección falló:", e.message));
      run.redirected = true;
      run.kill?.();
    } catch (e) {
      log("redirección falló:", e?.message ?? e);
    }
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
    for (const [id, b] of failedUntil) if (b.until < now) failedUntil.delete(id);
    const legacy = {
      activeRuns: [...activeRuns.values()].map((r) => ({
        title: r.title ?? "(reservando)",
        elapsedMin: Math.round((now - r.spawnedAt) / 60000),
        model: r.agent === "claude" ? `claude:${r.effectiveModel}` : r.effectiveModel,
      })),
      queueDepth,
      pid: process.pid,
    };
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
        // Misma escritura de cada 60 s (sin cadencia nueva): lo que la cola
        // de la app necesita para explicar por qué una tarea espera.
        blocked: [...failedUntil.entries()].map(([taskId, b]) => ({
          taskId,
          reason: b.reason,
          until: b.until,
        })),
        limits: {
          claude: MAX_PARALLEL_CLAUDE,
          zcodeDefault: MAX_PARALLEL_DEFAULT,
          zcodeDefaultModel: defaultModel || undefined,
        },
      },
    }).catch(async (e) => {
      // Backend todavía sin los campos nuevos (deploy de Convex pendiente):
      // el formato anterior mantiene vivo el "puente activo" de la app.
      if (!/validator|Validator|extra field|ArgumentValidationError/i.test(String(e?.message ?? e))) throw e;
      await m("agent:bridgeHeartbeat", { state: legacy });
    });
  } catch (e) {
    // El heartbeat nunca tumba el puente, pero tampoco falla en silencio
    // (un validador que lo rechazaba dejó la app viendo el puente "apagado").
    if (Date.now() - lastBeatErrorAt > 10 * 60 * 1000) {
      lastBeatErrorAt = Date.now();
      log("heartbeat falló:", e?.message ?? e);
    }
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

  // Red de respaldo contra una suscripción MUERTA en silencio (sufrido en
  // producción: WebSocket caído por horas → tareas encoladas varadas aunque
  // el puente siguiera "vivo"). El pump es idempotente (guards de
  // activeRuns/reserving): cada 2 min relee la cola por HTTP pase lo que
  // pase con la suscripción.
  setInterval(() => {
    pump().catch(() => {});
  }, 2 * 60 * 1000);

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
