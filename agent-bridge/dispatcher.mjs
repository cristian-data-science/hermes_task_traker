#!/usr/bin/env node
/**
 * agent-bridge — puente local: la app web despacha, ZCode ejecuta.
 *
 * Daemon que se suscribe REACTIVAMENTE a la cola de Convex (WebSocket): cuando
 * Cris crea una tarea con ejecutor ZCode, la recibe en segundos y:
 *   1. Valida la carpeta destino (y su coherencia tipo↔vcs).
 *   2. Reclama la tarea (claimTask → abre corrida) y arma el prompt empaquetado.
 *   3. Swap temporal del modelo elegido en el config de ZCode (backup+restore).
 *   4. Lanza `zcode -p` headless con --cwd carpeta, --mode según autonomía.
 *   5. Al terminar: vincula la sesión (resume para seguimientos), actúa de
 *      watchdog si el agente no reportó, y notifica por WhatsApp vía Hermes.
 *
 * Una tarea a la vez (MAX_CONCURRENT=1) por el swap del config de usuario.
 * Arranque: npm run agent-bridge  (o node agent-bridge/dispatcher.mjs)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
import { buildPrompt, promptDigest } from "./prompts.mjs";
import { notifyAgent } from "./notify.mjs";

const RUN_TIMEOUT_MS = Number(process.env.AGENT_RUN_TIMEOUT_MS || 60 * 60 * 1000);

let busy = 0;
let running = null; // { taskId, nudge, kill }
/** Tareas con corrida activa EN ESTE proceso (para detectar huérfanas). */
const active = new Set();

function log(...a) {
  console.log(`[${new Date().toLocaleTimeString()}]`, ...a);
}

/**
 * Corridas huérfanas: tareas en despachada/trabajando que NO están activas
 * acá (p.ej. el puente se reinició a mitad de corrida). Se marcan error para
 * que Cris las re-despache con un clic — nunca se relanzan solas.
 */
async function recoverStuck() {
  try {
    const overview = await q("agent:agentOverview");
    const stuck = [...(overview?.working ?? [])].filter((t) => !active.has(t._id));
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

/** Corrida de una tarea (envuelta para el registro de activas). */
async function dispatchTask(entry) {
  active.add(entry.task._id);
  try {
    await dispatchTaskInner(entry);
  } finally {
    active.delete(entry.task._id);
  }
}

async function dispatchTaskInner({ task, workspace }) {
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
    // Otro puente la tomó, o cambió de estado: no es error del daemon.
    log(`claim ${taskId}: ${e.message}`);
    return;
  }

  const prompt = buildPrompt({ task, workspacePath: folder, runId, followUp, resumed: !!task.agentSessionId });
  const mode = AUTONOMY_MODE[task.autonomy] ?? "yolo";
  // Sin --disallowed-tools: en 0.16.5 un spec "Bash(...)" tumba la
  // herramienta Bash entera (ver config.mjs). Los límites de git son
  // contractuales (prompt).

  log(`▶ despachando "${task.title}" [${task.taskType}/${task.autonomy}/${task.model ?? "default"}] → ${folder}`);

  // 3) Notificación de inicio (solo modo periodica).
  notifyAgent(notifyMode, "inicio", {
    title: task.title,
    state: "trabajando",
    folder,
    model: task.model,
    taskId,
  }).catch(() => {});

  // 4) Swap de modelo + spawn headless.
  // Nota 0.16.5: --max-turns aparece en el help pero NO está implementado
  // (igual que --settings); el cinturón de vueltas es el timeout de corrida.
  const restore = swapModel(task.model);
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
    await new Promise((resolve) => {
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
      running = {
        taskId,
        nudge: notifyMode === "periodica"
          ? setInterval(() => {
              notifyAgent(notifyMode, "nudge", {
                title: task.title,
                state: "trabajando (nudge)",
                summary: "La corrida sigue activa; sin novedades que reportar.",
                taskId,
              }).catch(() => {});
            }, NUDGE_MS)
          : null,
        kill: () => child.kill(),
      };

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
        log(`⏱ timeout ${RUN_TIMEOUT_MS / 60000}min — matando corrida`);
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
    }).then(async (res) => {
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
          }).catch(() => {});
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
    });
  } catch (err) {
    await m("agent:agentReport", {
      taskId,
      runId,
      state: "error",
      error: `el despachador falló: ${err?.message ?? err}`,
    }).catch(() => {});
  } finally {
    if (running?.nudge) clearInterval(running.nudge);
    running = null;
    restore();
  }
}

/** Token de sesión para el env de las corridas (se renueva a diario). */
let _tokenForChild = "";

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

/** Toma la cola pendiente y despacha hasta vaciarla (respetando concurrencia). */
async function pump() {
  while (busy < MAX_CONCURRENT) {
    let queue;
    try {
      queue = await q("agent:agentQueue");
    } catch (e) {
      log("agentQueue falló:", e.message);
      return;
    }
    const next = queue?.[0];
    if (!next) return;
    busy++;
    try {
      await dispatchTask(next);
    } finally {
      busy--;
    }
  }
}

async function main() {
  const problems = assertConfig();
  if (problems.length) {
    console.error("Configuración incompleta del puente:\n - " + problems.join("\n - "));
    process.exit(1);
  }
  if (restoreOrphanSwap()) log("swap de modelo huérfano restaurado");

  _tokenForChild = await getToken();
  log(`puente activo → ${CONVEX_URL}`);

  // Sembrar carpetas por defecto (idempotente) y sincronizar modelos.
  await m("agent:seedWorkspaces").catch((e) => log("seedWorkspaces:", e.message));
  await syncModels().catch((e) => log("syncModels:", e.message));

  // Heartbeat: indicador "puente activo" en la app + barrido de huérfanas.
  const beat = async () => {
    await m("agent:bridgeHeartbeat").catch(() => {});
    await recoverStuck();
  };
  await beat();
  setInterval(() => void beat(), 60_000);

  // Suscripción reactiva: cada cambio de la cola dispara un pump.
  // (convex 1.42: ConvexClient.onUpdate; devuelve el unsubscribe.)
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
    if (running?.nudge) clearInterval(running.nudge);
    if (running?.kill) running.kill();
    client.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error("puente murió:", err);
  process.exit(1);
});
