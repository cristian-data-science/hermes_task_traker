#!/usr/bin/env node
/**
 * agent-bridge — puente local: la app web despacha, ZCode ejecuta.
 *
 * Daemon suscrito REACTIVAMENTE a la cola de Convex (WebSocket). Cuando Cris
 * crea una tarea con ejecutor ZCode:
 *   1. Valida la carpeta destino.
 *   2. Reclama la tarea (claimTask → abre corrida) y arma el prompt empaquetado.
 *   3. Lanza `zcode -p` headless con --cwd carpeta y --mode por autonomía.
 *   4. TAILER EN VIVO: lee el transcript de la sesión (rollout JSONL) cada 5s
 *      y reporta la última acción a la app → Cris ve qué hace en tiempo real.
 *   5. Watchdog: corrida sin actividad >STALL_MS → "posible atasco" (+WhatsApp
 *      si periodica); proceso terminado sin reporte → reporta el despachador.
 *   6. Al terminar: vincula la sesión (resume para seguimientos) y libera slot.
 *
 * Concurrencia: corridas con modelo EFECTIVO = default del config corren hasta
 * MAX_PARALLEL_DEFAULT en paralelo (no necesitan swap de config); modelo
 * distinto al default es EXCLUSIVO (necesita swap global).
 * Instancia única por lockfile (.bridge.lock).
 *
 * Arranque: npm run agent-bridge  ·  con auto-restart: npm run agent-bridge:daemon
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  openSync,
  readSync,
  closeSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexClient } from "convex/browser";
import {
  CONVEX_URL,
  ZCODE_CLI,
  AUTONOMY_MODE,
  MAX_CONCURRENT,
  NUDGE_MS,
  assertConfig,
} from "./config.mjs";
import { getToken, q, m } from "./auth.mjs";
import { readModelCatalog, swapModel, restoreOrphanSwap } from "./models.mjs";
import { buildPrompt } from "./prompts.mjs";
import { notifyAgent } from "./notify.mjs";

const RUN_TIMEOUT_MS = Number(process.env.AGENT_RUN_TIMEOUT_MS || 60 * 60 * 1000);
const MAX_PARALLEL_DEFAULT = Number(process.env.MAX_PARALLEL_DEFAULT || 2);
const STALL_MS = Number(process.env.AGENT_STALL_MS || 10 * 60 * 1000);
const TAIL_MS = 5000;
const BRIDGE_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOCK_FILE = path.join(BRIDGE_DIR, ".bridge.lock");
const ROLLOUT_DIR = path.join(os.homedir(), ".zcode", "cli", "rollout");

/** Corridas activas en este proceso: taskId → info de la corrida. */
const activeRuns = new Map();
/** Tareas ya reservadas por este pump (entre claim y arranque real). */
const reserving = new Set();
let defaultModel = "";
let queueDepth = 0;
/** Token de sesión para el env de las corridas (se renueva a diario). */
let _tokenForChild = "";

function log(...a) {
  console.log(`[${new Date().toLocaleTimeString()}]`, ...a);
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

/** Modelo efectivo de una tarea: el elegido, o el default del config. */
function effectiveModel(task) {
  return task.model || defaultModel || "";
}

/**
 * ¿Puede arrancar otra corrida ahora? Regla del swap global: si hay corridas
 * activas, todas deben ser del default y la nueva también (hasta el tope);
 * un modelo distinto exige exclusividad total.
 */
function canDispatch(effective) {
  if (activeRuns.size === 0) return true;
  if (effective !== defaultModel) return false;
  const allDefault = [...activeRuns.values()].every(
    (r) => r.effectiveModel === defaultModel,
  );
  return allDefault && activeRuns.size < MAX_PARALLEL_DEFAULT;
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

/** Sincroniza el catálogo de modelos de la instalación → picker de la app. */
async function syncModels() {
  const { models, default: def } = readModelCatalog();
  if (!models.length) return;
  await m("agent:syncModels", { models, default: def });
  log(`modelos sincronizados: ${models.length} (default ${def})`);
}

// ===== TAILER EN VIVO: transcript de la sesión → actividad en la app =====

/**
 * Encuentra el rollout JSONL de la corrida: archivo nuevo (mtime posterior al
 * spawn) cuyo contenido menciona el taskId. Reintenta hasta encontrarlo.
 */
function findRolloutFile(sinceMs, taskId) {
  try {
    const cands = readdirSync(ROLLOUT_DIR)
      .filter((f) => f.startsWith("model-io-") && f.endsWith(".jsonl"))
      .map((f) => path.join(ROLLOUT_DIR, f))
      .filter((f) => statSync(f).mtimeMs >= sinceMs - 10_000)
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    for (const f of cands) {
      try {
        const fd = openSync(f, "r");
        const head = Buffer.alloc(8192);
        readSync(fd, head, 0, 8192, 0);
        closeSync(fd);
        if (head.toString("utf8").includes(taskId)) return f;
      } catch {
        continue;
      }
    }
  } catch {
    // rollout dir inexistente en este arranque
  }
  return null;
}

/** Extrae una descripción corta de la última acción dentro de una línea JSONL. */
function describeLine(line) {
  // Última tool_use de la línea: nombre + primer campo del input abreviado.
  const tools = [
    ...line.matchAll(
      /"name":"([A-Za-z_]+)","input":\{"([a-z_]+)":"((?:[^"\\]|\\.){0,70})/g,
    ),
  ];
  if (tools.length) {
    const [, name, key, val] = tools[tools.length - 1];
    const v = val.replace(/\\n/g, " ").replace(/\\"/g, '"').trim();
    return `${name}: ${key}=${v}`.slice(0, 160);
  }
  // Si no, último texto del asistente.
  const texts = [...line.matchAll(/"type":"text","text":"((?:[^"\\]|\\.){10,240})"/g)];
  if (texts.length) {
    const t = texts[texts.length - 1][1].replace(/\\n/g, " ").trim();
    return t.slice(0, 160);
  }
  return null;
}

/** Observa el rollout de una corrida y reporta actividad nueva cada TAIL_MS. */
function startTailer(run) {
  let fileSize = 0;
  let lastText = "";
  let file = null;
  const timer = setInterval(() => {
    try {
      if (!file) {
        file = findRolloutFile(run.spawnedAt, run.taskId);
        if (!file) return;
      }
      const size = statSync(file).size;
      if (size <= fileSize) return;
      // Leemos solo el agregado (con margen para cortar a línea completa).
      const fd = openSyncSafe(file);
      if (!fd) return;
      const start = fileSize > 0 ? Math.max(0, fileSize - 1) : Math.max(0, size - 200_000);
      const buf = Buffer.alloc(size - start);
      readFd(fd, buf, start);
      closeSyncSafe(fd);
      fileSize = size;
      const text = buf.toString("utf8");
      const lines = text.split("\n").filter((l) => l.trim().startsWith("{"));
      for (const line of lines) {
        const desc = describeLine(line);
        if (desc && desc !== lastText) lastText = desc;
      }
      if (lastText) {
        run.lastActivityAt = Date.now();
        m("agent:runActivity", {
          taskId: run.taskId,
          runId: run.runId,
          activity: lastText,
        }).catch(() => {});
      }
    } catch {
      // transcript puede rotar/desaparecer: el tailer es best-effort
    }
  }, TAIL_MS);
  return timer;
}

// Wrappers sync mínimos para lecturas posicionales sin cargar el archivo entero.
function openSyncSafe(file) {
  try {
    return openSync(file, "r");
  } catch {
    return null;
  }
}
function readFd(fd, buf, position) {
  try {
    readSync(fd, buf, 0, buf.length, position);
  } catch {
    // lectura parcial: el siguiente tick reintenta
  }
}
function closeSyncSafe(fd) {
  try {
    closeSync(fd);
  } catch {
    // ya cerrado
  }
}

// ===== DESPACHO =====

async function dispatchTask(entry) {
  const taskId = entry.task._id;
  const run = {
    taskId,
    title: entry.task.title,
    effectiveModel: effectiveModel(entry.task),
    spawnedAt: Date.now(),
    lastActivityAt: Date.now(),
    stalledNotified: false,
  };
  activeRuns.set(taskId, run);
  try {
    await dispatchTaskInner(entry, run);
  } finally {
    activeRuns.delete(taskId);
    // Un slot liberado puede habilitar tareas en cola.
    pump().catch(() => {});
  }
}

async function dispatchTaskInner({ task, workspace }, run) {
  const taskId = task._id;
  const folder = task.workspacePath || workspace?.path || "";
  const notifyMode = task.notifyWhatsapp ?? "off";

  // 1) Carpeta en disco: sin carpeta el agente no sabe dónde trabajar →
  //    pregunta (no error): Cris elige la carpeta en la app y re-encola.
  if (!folder || !existsSync(folder)) {
    await m("agent:agentReport", {
      taskId,
      state: "pregunta",
      question: folder
        ? `La carpeta destino no existe en este PC: ${folder}. Corregila en la app y respondé acá para reintentar.`
        : "La tarea no tiene carpeta destino. Elegila al editar la tarea y respondé acá para que reintente.",
      error: folder ? `carpeta inexistente: ${folder}` : "sin carpeta destino",
    }).catch((e) => log("report pregunta falló:", e.message));
    return;
  }

  // 2) Reclamar (abre la corrida y entrega el followUp pendiente de Cris).
  let runId, followUp;
  try {
    const claimed = await m("agent:claimTask", {
      taskId,
      resumed: !!task.agentSessionId,
      workspacePath: folder,
    });
    runId = claimed.runId;
    followUp = claimed.followUp;
  } catch (e) {
    log(`claim ${taskId}: ${e.message}`);
    return;
  }
  run.runId = runId;

  const prompt = buildPrompt({ task, workspacePath: folder, runId, followUp, resumed: !!task.agentSessionId });
  const mode = AUTONOMY_MODE[task.autonomy] ?? "yolo";
  const needsSwap = run.effectiveModel !== defaultModel;
  // Sin --disallowed-tools: en 0.16.5 un spec "Bash(...)" tumba la
  // herramienta Bash entera (ver config.mjs). Los límites de git son
  // contractuales (prompt).

  log(
    `▶ despachando "${task.title}" [${task.taskType}/${task.autonomy}/${run.effectiveModel.split("/").pop()}] → ${folder}` +
      (activeRuns.size > 1 ? ` (paralela, ${activeRuns.size} activas)` : ""),
  );

  // 3) Notificación de inicio (solo modo periodica).
  notifyAgent(notifyMode, "inicio", {
    title: task.title,
    state: "trabajando",
    folder,
    model: run.effectiveModel,
    taskId,
  }).catch(() => {});

  // 4) Swap de modelo SOLO si se necesita (y por la regla de canDispatch, en
  //    ese caso esta corrida es la única activa).
  const restore = needsSwap ? swapModel(run.effectiveModel) : null;
  const args = [
    ZCODE_CLI,
    "-p",
    prompt,
    "--cwd",
    folder,
    "--mode",
    mode,
    "--json",
  ];

  try {
    const res = await new Promise((resolve) => {
      const child = spawn(process.execPath, args, {
        env: {
          ...process.env,
          ZCODE_TASK_ID: taskId,
          ZCODE_RUN_ID: runId,
          ZCODE_SESSION_TOKEN: _tokenForChild,
          ZCODE_CONVEX_URL: CONVEX_URL,
        },
        windowsHide: true,
      });
      run.kill = () => child.kill();
      run.nudge = notifyMode === "periodica"
        ? setInterval(() => {
            notifyAgent(notifyMode, "nudge", {
              title: task.title,
              state: "trabajando (nudge)",
              summary: "La corrida sigue activa; sin novedades que reportar.",
              taskId,
            }).catch(() => {});
          }, NUDGE_MS)
        : null;
      run.tailer = startTailer(run);

      let stdout = "";
      child.stdout.on("data", (d) => {
        stdout += d;
        if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000);
      });
      child.stderr.on("data", (d) => {
        const s = String(d);
        if (s.trim()) log(`  [zcode] ${s.trim().slice(0, 300)}`);
      });

      const timeout = setTimeout(() => {
        log(`⏱ timeout ${RUN_TIMEOUT_MS / 60000}min — matando corrida "${task.title}"`);
        child.kill();
      }, RUN_TIMEOUT_MS);

      child.on("error", (err) => {
        clearTimeout(timeout);
        resolve({ code: -1, err: String(err), stdout });
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        resolve({ code, stdout });
      });
    });

    // 5) Vincular sesión + watchdog si el agente no reportó.
    const sessionId = extractSessionId(res.stdout);
    if (sessionId) {
      await m("agent:bindSession", { taskId, sessionId, runId }).catch(() => {});
    }
    const runs = await q("agent:runsByTask", { taskId }).catch(() => []);
    const open = (runs || []).some(
      (r) =>
        r.state === "despachada" || r.state === "trabajando" || r.state === "pregunta",
    );
    if (open) {
      const response = extractResponse(res.stdout);
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
          error: `zcode terminó con código ${res.code}${res.err ? `: ${res.err}` : ""}`,
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
    if (restore) restore();
  }
}

function extractSessionId(stdout) {
  const m = String(stdout).match(/"sessionId":\s*"(sess_[a-f0-9-]+)"/);
  return m ? m[1] : null;
}

function extractResponse(stdout) {
  try {
    const j = JSON.parse(stdout);
    return typeof j.response === "string" ? j.response : null;
  } catch {
    return null;
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
    if (!canDispatch(effectiveModel(entry.task))) continue;
    reserving.add(id);
    void dispatchTask(entry)
      .catch((e) => log("dispatch:", e.message))
      .finally(() => reserving.delete(id));
  }
}

/** Watchdog de atascos + kill de tareas borradas/canceladas + heartbeat rico. */
async function beat() {
  try {
    const now = Date.now();
    for (const run of activeRuns.values()) {
      // ¿Cris borró o canceló la tarea mientras corría? Matar la corrida ya.
      const t = await q("tasks:get", { taskId: run.taskId }).catch(() => null);
      if (
        !t ||
        t.deletedAt !== undefined ||
        t.agentState === "cancelada" ||
        t.executor !== "zcode"
      ) {
        log(`✗ "${run.title}" borrada/cancelada — matando corrida ${run.runId}`);
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
          model: r.effectiveModel,
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
  acquireLock();
  if (restoreOrphanSwap()) log("swap de modelo huérfano restaurado");

  _tokenForChild = await getToken();
  defaultModel = readModelCatalog().default || "";
  log(`puente activo → ${CONVEX_URL} (default ${defaultModel}, paralelas default: ${MAX_PARALLEL_DEFAULT})`);

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
