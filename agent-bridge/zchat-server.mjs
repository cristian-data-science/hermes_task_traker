#!/usr/bin/env node
/**
 * zchat-server — chat WEB local con la sesión del agente de una tarea (v4).
 *
 *   node zchat-server.mjs <sessionId|-> <workspacePath> [planB64] [status] [agentState] [taskId] [theme] [agent]
 *   (un "-" en cualquier posicional equivale a vacío; así el .vbs puede pasar
 *   los argumentos siempre en el mismo orden; agent: zcode|claude, default zcode)
 *
 *   Con sessionId vacío ("-") y taskId válido arranca en SESIÓN PENDIENTE:
 *   el botón del tracker se abre antes de que el agente registre su sesión y
 *   el server la adopta apenas Convex reporta agentSessionId (o el sessionId
 *   de la corrida más reciente). Mientras tanto /history es vacío, /ask
 *   responde 409 pendingSession y la UI muestra la espera.
 *
 * Servidor en 127.0.0.1 (puerto 43110+) que sirve la UI de agent-bridge/zchat-ui
 * y expone:
 *
 *  - /history   Conversación completa de la sesión en forma estructurada:
 *               texto, razonamiento y herramientas por mensaje. ZCode: db.sqlite
 *               (message+part). Claude: el <session>.jsonl de ~/.claude/projects
 *               (correlacionando tool_use ↔ tool_result). Oculta los mensajes
 *               sintéticos/ocultos y limpia los prefijos que este chat inyecta.
 *  - /ask       Lanza un turno (`zcode|claude -p --resume <sess>`) y devuelve el
 *               id del turno de inmediato. El progreso viaja por /events.
 *  - /events    SSE con TODO el turno en vivo. Fuente primaria: el CLI corre
 *               con `--output-format stream-json` y escribe en stdout un
 *               evento por token (razonamiento y texto), por herramienta
 *               (inicio, resultado) y al final (respuesta + tokens). Cada
 *               evento lleva `id:` → el navegador reconecta solo con
 *               Last-Event-ID y el servidor le re-envía lo que se perdió.
 *  - /state     Foto completa (turno en curso con sus bloques, tracker, seq):
 *               recargar la página a mitad de una respuesta no pierde nada.
 *  - tracker    Si llega taskId y hay credenciales del puente (auth.mjs), se
 *               suscribe a Convex (tasks:get + agent:runsByTask) y empuja el
 *               plan, el paso actual, la actividad y el estado EN VIVO. Ese
 *               estado fresco también se inyecta en cada pregunta.
 *
 * Multi-agente: mismo protocolo de eventos para la UI; el adaptador traduce
 * (zcode: model.streaming/tool.updated · claude: stream_event/assistant/user
 * tool_result). Ambos chatean en modo read-only (zcode --mode plan ·
 * claude --permission-mode plan).
 *
 * Robustez: un turno a la vez con timeout (15 min) y /cancel; instancia única
 * por sesión (si ya hay un servidor para esta sesión, abre esa pestaña y sale);
 * auto-apagado tras 30 min sin uso (nunca con un turno corriendo).
 *
 * Variables: ZCHAT_POLL_MS (200) · ZCHAT_TURN_TIMEOUT_MS (900000) ·
 * ZCHAT_IDLE_MS (1800000) · ZCHAT_NO_OPEN=1 (no abre el navegador) ·
 * ZCHAT_DEMO=1 (turnos simulados, sin CLI: para probar la UI sin gastar tokens).
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";
import { existsSync, appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { adapterFor } from "./agents/index.mjs";

const VERSION = "4.0.0";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(HERE, "zchat-ui");
const LOG = path.join(HERE, "zchat-server.log");
const PORT_BASE = 43110;
const PORT_SPAN = 12;
const POLL_MS = Number(process.env.ZCHAT_POLL_MS || 200);
const TURN_TIMEOUT_MS = Number(process.env.ZCHAT_TURN_TIMEOUT_MS || 15 * 60 * 1000);
const IDLE_MS = Number(process.env.ZCHAT_IDLE_MS || 30 * 60 * 1000);
const DEMO = process.env.ZCHAT_DEMO === "1";
const NO_OPEN = process.env.ZCHAT_NO_OPEN === "1";
const EVENTS_MAX = 4000;

const ZCODE_CLI =
  process.env.ZCODE_CLI ||
  path.join(os.homedir(), "AppData", "Local", "Programs", "ZCode", "resources", "glm", "zcode.cjs");
const DB_PATH = path.join(os.homedir(), ".zcode", "cli", "db", "db.sqlite");

const log = (m) => {
  try {
    appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`);
  } catch {}
};

// ---- Argumentos ----
const argv = process.argv.slice(2).map((a) => (a === "-" ? "" : a));
let [sessionId, workspacePath, planB64 = "", statusArg = "", stateArg = "", taskIdArg = "", themeArg = "", agentArg = ""] = argv;
// Sesión PENDIENTE: el botón del panel puede abrir el chat ANTES de que el
// agente registre su sesión (ZCode la crea al arrancar el proceso). Con taskId
// válido el server espera la sesión por Convex (agentSessionId de la tarea o
// sessionId de la corrida más reciente) y la adopta apenas aparece.
const sessionPending = !sessionId;
if (!workspacePath || (!sessionId && !taskIdArg)) {
  console.error("uso: node zchat-server.mjs <sessionId|-> <workspacePath> [planB64] [status] [agentState] [taskId] [theme] [agent]");
  process.exit(1);
}
const AGENT = agentArg === "claude" ? "claude" : "zcode";
const adapter = adapterFor(AGENT);
if (!DEMO && AGENT === "zcode" && !existsSync(ZCODE_CLI)) {
  console.error(`No encuentro el CLI de ZCode: ${ZCODE_CLI}`);
  process.exit(1);
}
const taskId = /^[a-z0-9]{10,64}$/i.test(taskIdArg) ? taskIdArg : "";
const themeHint = themeArg === "console" ? "console" : "";
const taskStatus = statusArg.slice(0, 40);
const taskAgentState = stateArg.slice(0, 40);

let planFromLink = [];
try {
  if (planB64) {
    const parsed = JSON.parse(
      Buffer.from(planB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    );
    if (Array.isArray(parsed)) planFromLink = parsed.map(String).slice(0, 12);
  }
} catch (e) {
  log(`plan no decodificable: ${e?.message ?? e}`);
}

// ---- DB de sesiones (read-only, conexión persistente con reapertura ante error) ----
let _db = null;
function db() {
  if (!_db) _db = new DatabaseSync(DB_PATH, { readOnly: true });
  return _db;
}
function dbReset() {
  try {
    _db?.close();
  } catch {}
  _db = null;
}
function safeQuery(fn, fallback) {
  try {
    return fn(db());
  } catch (e) {
    log(`db: ${e?.message ?? e}`);
    dbReset();
    return fallback;
  }
}

let sessionTitle =
  AGENT === "claude"
    ? "" // Claude no titula sesiones; la UI muestra la tarea del tracker.
    : sessionId
      ? safeQuery((d) => d.prepare("SELECT title FROM session WHERE id = ?").get(sessionId)?.title, "") ?? ""
      : "";

/**
 * Adopción de la sesión pendiente: cuando Convex reporta el agentSessionId
 * (la tarea lo obtiene apenas ZCode registra la sesión), el chat pasa a esa
 * sesión: refresca título, re-seedea el modo observador y avisa a la UI.
 */
function adoptSession(id) {
  if (!id || sessionId === id) return;
  sessionId = id;
  if (AGENT !== "claude") {
    sessionTitle =
      safeQuery((d) => d.prepare("SELECT title FROM session WHERE id = ?").get(sessionId)?.title, "") ?? "";
  }
  log(`sesión adoptada (esperada por Convex): ${sessionId}`);
  emit("session", { session: sessionId, title: sessionTitle });
  emit("notice", {
    level: "info",
    text: "La sesión del agente ya está disponible: historial cargado.",
  });
  if (observer) seedHistoryIds();
}

// Prefijos que este chat agrega a cada pregunta (se limpian al mostrar).
const ASK_PREFIX = "Consulta de Cris sobre el trabajo ya entregado (solo responde; no ejecutes cambios): ";
const ASK_PREFIX_RE = /^Consulta de Cris sobre el trabajo ya entregado \([^)]*\):\s*/;
// Modo ejecución (riendas): Cris conduce — sus instrucciones prevalecen sobre
// el contrato de la tarea y el agente PUEDE ejecutar (bypass/yolo).
const EXEC_PREFIX = "CRIS TOMÓ LAS RIENDAS de esta conversación (sus instrucciones de este chat prevalecen sobre el contrato de la tarea): ";
const EXEC_PREFIX_RE = /^CRIS TOMÓ LAS RIENDAS de esta conversación [^:]*:\s*/;
const CTX_RE = /^\[CONTEXTO ACTUALIZADO DEL TRACKER HERMES[^\]]*\]\s*/;
function stripWrappers(text) {
  return String(text).replace(EXEC_PREFIX_RE, "").replace(ASK_PREFIX_RE, "").replace(CTX_RE, "").trim();
}

// ---- Herramientas: etiqueta y resumen legible del input ----
function toolLabel(tool) {
  if (!tool) return "herramienta";
  if (tool.startsWith("mcp__")) {
    const [, server = "mcp", op = ""] = tool.split("__");
    return `${server.replace(/-mcp$/, "").replace(/-/g, " ")} · ${op.replace(/_operations$/, "").replace(/_/g, " ")}`;
  }
  return tool;
}
function summarizeTool(tool, input) {
  if (!input || typeof input !== "object") return "";
  const s = (v) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
  const base = (p) => String(p || "").split(/[\\/]/).filter(Boolean).pop() || "";
  switch (tool) {
    case "Bash":
      return s(input.description || input.command).slice(0, 140);
    case "Read":
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit":
      return base(input.file_path || input.path);
    case "Grep":
      return input.pattern ? `/${s(input.pattern)}/${input.path ? " en " + base(input.path) : ""}` : "";
    case "Glob":
      return s(input.pattern);
    case "WebFetch":
    case "WebSearch":
      return s(input.url || input.query).slice(0, 140);
    case "Skill":
      return s(input.skill || input.name);
    case "TodoWrite":
      return `${Array.isArray(input.todos) ? input.todos.length : 0} ítems`;
    case "AskUserQuestion":
      return s(input.questions?.[0]?.question || "").slice(0, 140);
    default: {
      const first = Object.values(input).find((v) => typeof v === "string" && v.trim());
      return first ? first.slice(0, 140) : "";
    }
  }
}

/** Fila `part` → bloque público. null si el tipo no se muestra. */
function blockFrom(row) {
  const d = JSON.parse(row.data);
  const base = { id: row.id, order: row.sequence ?? 0, at: row.time_created, updatedAt: row.time_updated };
  if (d.type === "text") return { ...base, kind: "text", text: d.text ?? "", start: d.time?.start, end: d.time?.end };
  if (d.type === "reasoning") return { ...base, kind: "reasoning", text: d.text ?? "", start: d.time?.start, end: d.time?.end };
  if (d.type === "tool") {
    const st = d.state || {};
    return {
      ...base,
      kind: "tool",
      tool: d.tool || "herramienta",
      label: toolLabel(d.tool),
      status: st.status || "pending",
      summary: summarizeTool(d.tool, st.input),
      title: typeof st.title === "string" ? st.title.slice(0, 160) : "",
      output: st.status === "completed" ? String(st.output ?? "").slice(0, 1500) : "",
      error: st.status === "error" ? String(st.error ?? "").slice(0, 800) : "",
      start: st.time?.start,
      end: st.time?.end,
    };
  }
  if (d.type === "step-finish") return { ...base, kind: "step", tokens: d.tokens, reason: d.reason };
  return null;
}

function addTokens(acc, t) {
  if (!t) return acc;
  const a = acc || { input: 0, output: 0, total: 0, cacheRead: 0 };
  a.input += t.input || 0;
  a.output += t.output || 0;
  a.total += t.total || 0;
  a.cacheRead += t.cache?.read || 0;
  return a;
}

/** Conversación completa estructurada (últimos `limit` mensajes visibles). */
function readHistory(limit = 80) {
  // Sesión todavía no adoptada: historial vacío (la UI muestra la espera).
  if (!sessionId) return { total: 0, messages: [], pending: true };
  if (AGENT === "claude") return readClaudeHistory(limit);
  return safeQuery(
    (d) => {
      const msgs = d
        .prepare("SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY sequence, time_created")
        .all(sessionId);
      const getParts = d.prepare(
        "SELECT id, sequence, time_created, time_updated, data FROM part WHERE message_id = ? ORDER BY sequence",
      );
      const out = [];
      for (const m of msgs) {
        let md;
        try {
          md = JSON.parse(m.data);
        } catch {
          continue;
        }
        if (md.synthetic || md.semantics?.uiVisibility === "hidden") continue;
        const role = md.role === "user" ? "user" : "assistant";
        const blocks = [];
        let tokens = null;
        for (const p of getParts.all(m.id)) {
          let b;
          try {
            b = blockFrom(p);
          } catch {
            continue;
          }
          if (!b) continue;
          if (b.kind === "step") {
            tokens = addTokens(tokens, b.tokens);
            continue;
          }
          if ((b.kind === "text" || b.kind === "reasoning") && !b.text.trim()) continue;
          if (role === "user") {
            if (b.kind !== "text") continue;
            b.text = stripWrappers(b.text);
            if (!b.text) continue;
          }
          blocks.push(b);
        }
        if (!blocks.length) continue;
        out.push({
          id: m.id,
          role,
          at: m.time_created,
          completedAt: md.time?.completed,
          model: md.modelID,
          tokens: tokens || undefined,
          blocks,
        });
      }
      return { total: out.length, messages: out.slice(-limit) };
    },
    { total: 0, messages: [] },
  );
}

/**
 * Historial Claude: lee el <session>.jsonl de ~/.claude/projects/<cwd>/ y lo
 * convierte a la MISMA forma que el historial de ZCode (role + blocks
 * text/reasoning/tool + tokens). Los tool_use se correlacionan con el
 * tool_result del mensaje user siguiente (así el bloque muestra su salida).
 */
function readClaudeHistory(limit = 80) {
  const file = adapter.sessionFile?.(sessionId, workspacePath);
  if (!file) return { total: 0, messages: [] };
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { total: 0, messages: [] };
  }
  const out = [];
  const toolBlocks = new Map(); // tool_use_id → bloque (para el resultado)
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j.isSidechain || j.isMeta || j.type === "summary") continue;
    const at = Date.parse(j.timestamp || "") || 0;
    if (j.type === "user") {
      const content = j.message?.content;
      const texts = [];
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === "tool_result" && c.tool_use_id) {
            const blk = toolBlocks.get(c.tool_use_id);
            if (blk) {
              const res = typeof c.content === "string"
                ? c.content
                : Array.isArray(c.content)
                  ? c.content.map((x) => x?.text ?? "").join("\n")
                  : "";
              if (c.is_error) {
                blk.status = "error";
                blk.error = String(res).slice(0, 800) || "la herramienta falló";
              } else {
                blk.status = "completed";
                blk.output = String(res).slice(0, 1500);
              }
            }
          } else if (c?.type === "text") {
            texts.push(c.text ?? "");
          }
        }
      } else if (typeof content === "string") {
        texts.push(content);
      }
      const txt = stripWrappers(texts.join("\n"));
      if (txt) {
        out.push({
          id: j.uuid || `u${out.length}`,
          role: "user",
          at,
          blocks: [{ id: `${j.uuid ?? out.length}:0`, order: 0, at, kind: "text", text: txt }],
        });
      }
      continue;
    }
    if (j.type !== "assistant") continue;
    const msg = j.message || {};
    const blocks = [];
    let order = 0;
    for (const c of msg.content ?? []) {
      if (c?.type === "text" && (c.text ?? "").trim()) {
        blocks.push({ id: `${j.uuid}:${order}`, order: order++, at, kind: "text", text: c.text });
      } else if (c?.type === "thinking" && (c.thinking ?? "").trim()) {
        blocks.push({ id: `${j.uuid}:${order}`, order: order++, at, kind: "reasoning", text: c.thinking });
      } else if (c?.type === "tool_use") {
        const blk = {
          id: `tool:${c.id}`,
          order: order++,
          at,
          kind: "tool",
          tool: c.name || "herramienta",
          label: toolLabel(c.name),
          status: "running",
          summary: summarizeTool(c.name, c.input),
          title: "",
          output: "",
          error: "",
        };
        blocks.push(blk);
        toolBlocks.set(c.id, blk);
      }
    }
    const u = msg.usage;
    const tokens = u
      ? {
          input: u.input_tokens || 0,
          output: u.output_tokens || 0,
          total: (u.input_tokens || 0) + (u.output_tokens || 0),
          cacheRead: u.cache_read_input_tokens || 0,
        }
      : null;
    if (blocks.length) {
      out.push({ id: j.uuid, role: "assistant", at, model: msg.model, tokens: tokens ?? undefined, blocks });
    }
  }
  // Tool sin resultado visible (corrida cortada): cerrarlo como completado.
  for (const blk of toolBlocks.values()) {
    if (blk.status === "running") {
      blk.status = "completed";
      blk.output = "";
    }
  }
  return { total: out.length, messages: out.slice(-limit) };
}

// ---- Eventos (SSE con ring buffer para replay) ----
let seq = 0;
const events = [];
const sseClients = new Set();
function emit(type, payload) {
  seq++;
  const ev = { seq, type, t: Date.now(), ...payload };
  events.push(ev);
  if (events.length > EVENTS_MAX) events.splice(0, events.length - EVENTS_MAX);
  const frame = `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(ev)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(frame);
    } catch {
      sseClients.delete(res);
    }
  }
}

// ---- Tracker en vivo (Convex) ----
let tracker = {
  live: false,
  source: "snapshot",
  updatedAt: Date.now(),
  task: {
    id: taskId || undefined,
    title: "",
    status: taskStatus,
    agentState: taskAgentState,
  },
  run: planFromLink.length
    ? { plan: planFromLink, steps: [], open: false, doneCount: 0, current: 0 }
    : null,
};
let trackerClient = null;

function computeTracker(task, runs) {
  const list = Array.isArray(runs) ? [...runs].sort((a, b) => b.startedAt - a.startedAt) : [];
  const latest = list[0] || null;
  const planRun = list.find((r) => Array.isArray(r.plan) && r.plan.length) || null;
  const plan = planRun?.plan ?? planFromLink;
  const steps = (planRun ?? latest)?.progressLog ?? [];
  const planOpen = !!planRun && !planRun.endedAt;
  const doneCount = steps.length;
  const current = plan.length ? Math.min(doneCount + (planOpen ? 1 : 0), plan.length) : 0;
  return {
    live: true,
    source: "convex",
    updatedAt: Date.now(),
    task: task
      ? {
          id: task._id,
          title: task.title,
          status: task.status,
          agentState: task.agentState,
          taskType: task.taskType,
          autonomy: task.autonomy,
          area: task.area,
          model: task.model,
          progress: task.progress,
          question: task.agentQuestion,
          lastStep: task.agentLastStep,
          lastStepAt: task.agentLastStepAt,
          stepIndex: task.agentStepIndex,
          planTotal: task.agentPlanTotal,
          redirect: task.agentRedirect,
          updatedAt: task.updatedAt,
          completedAt: task.completedAt,
          notes: typeof task.notes === "string" ? task.notes.slice(0, 600) : undefined,
        }
      : { id: taskId, title: "", status: taskStatus, agentState: taskAgentState, deleted: true },
    run: latest
      ? {
          id: latest._id,
          state: latest.state,
          plan,
          planRunId: planRun?._id,
          planOpen,
          steps,
          doneCount,
          current,
          open: !latest.endedAt,
          lastActivity: latest.lastActivity,
          lastActivityAt: latest.lastActivityAt,
          stalled: !!latest.stalled,
          summary: latest.summary,
          error: latest.error,
          followUp: latest.followUp,
          startedAt: latest.startedAt,
          endedAt: latest.endedAt,
          model: latest.model,
          resumed: latest.resumed,
          runsCount: list.length,
        }
      : tracker.run,
  };
}

// ---- Modo observador (corrida del dispatcher activa sobre esta tarea) ----
// El chat no puede lanzar turnos propios mientras el dispatcher corre (dos
// procesos sobre la misma sesión se pisan); en su lugar, MUESTRA lo que pasa:
// poll del historial y eventos history_append con los mensajes nuevos.
let observer = false;
let observerPoller = null;
let historyIds = new Set();

/**
 * Ventana móvil del poll observador. El set de ids conocidos se REEMPLAZA por
 * los ids de esta ventana en cada tick (nunca crece): lo que ya salió de la
 * ventana no vuelve a aparecer, así que no hace falta recordarlo.
 */
const OBSERVER_WINDOW = 120;

/** (Re)inicializa el set de mensajes conocidos sin emitir nada. */
function seedHistoryIds() {
  historyIds = new Set(readHistory(OBSERVER_WINDOW).messages.map((m) => m.id));
}

/**
 * Activa/desactiva el modo observador según si la corrida está abierta.
 * Al activar: divisor visual + poll cada 2 s. Al desactivar: notice de que
 * ya se puede preguntar.
 */
function syncObserver(runOpen) {
  if (runOpen === observer) return;
  observer = runOpen;
  emit("observer", { observer });
  if (observer) {
    seedHistoryIds();
    if (!observerPoller) {
      observerPoller = setInterval(() => {
        try {
          const { messages } = readHistory(OBSERVER_WINDOW);
          const fresh = messages.filter((m) => !historyIds.has(m.id));
          historyIds = new Set(messages.map((m) => m.id));
          if (fresh.length) {
            // El usuario está mirando: cuenta como actividad (no auto-apagar).
            lastActivity = Date.now();
            emit("history_append", { messages: fresh });
          }
        } catch {
          // lectura transitoria (sqlite ocupada): reintenta el próximo tick
        }
      }, 2000);
    }
  } else {
    if (observerPoller) {
      clearInterval(observerPoller);
      observerPoller = null;
    }
    emit("notice", {
      level: "info",
      text: "La corrida terminó — ya puedes preguntarle al agente.",
    });
  }
}

// ---- Modo ejecución (riendas): Cris conduce, el contrato queda subordinado
// a SUS instrucciones explícitas del chat. Default OFF (solo consulta). ----
let execMode = false;

async function startTracker() {
  if (!taskId) return;
  try {
    const [{ ConvexClient }, { getToken }, { CONVEX_URL }] = await Promise.all([
      import("convex/browser"),
      import("./auth.mjs"),
      import("./config.mjs"),
    ]);
    const token = await getToken();
    const client = new ConvexClient(CONVEX_URL);
    trackerClient = client;
    let task;
    let runs;
    let timer = null;
    const push = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (task === undefined || runs === undefined) return;
        // Sesión pendiente: adoptar apenas Convex la reporte (tarea o corrida).
        if (!sessionId) {
          const fromRun = [...(runs ?? [])]
            .filter((r) => r.sessionId)
            .sort((a, b) => b.startedAt - a.startedAt)[0]?.sessionId;
          adoptSession(task?.agentSessionId || fromRun || "");
          if (!sessionId) return; // sigue sin sesión: nada que mostrar aún
        }
        tracker = computeTracker(task, runs);
        emit("tracker", { tracker });
        // ¿Hay una corrida del dispatcher ABIERTA sobre esta tarea? → el chat
        // pasa a modo observador (historial vivo, sin turnos propios).
        syncObserver(tracker.run?.open === true);
      }, 120);
    };
    client.onUpdate(
      "tasks:get",
      { sessionToken: token, id: taskId },
      (t) => {
        task = t;
        push();
      },
      (err) => log(`tracker tasks:get: ${err?.message ?? err}`),
    );
    client.onUpdate(
      "agent:runsByTask",
      { sessionToken: token, taskId },
      (r) => {
        runs = r;
        push();
      },
      (err) => log(`tracker runsByTask: ${err?.message ?? err}`),
    );
    log(`tracker en vivo → ${CONVEX_URL} · tarea ${taskId}`);
  } catch (e) {
    log(`tracker apagado (snapshot del deep link): ${e?.message ?? e}`);
  }
}

// ---- Turnos ----
let turn = null;
let turnCounter = 0;
let lastActivity = Date.now();

function publicPart(p) {
  const { msgId, ...rest } = p;
  return { ...rest, msgId };
}
function snapshotTurn(t) {
  if (!t) return null;
  return {
    id: t.id,
    question: t.question,
    startedAt: t.startedAt,
    status: t.status,
    parts: t.order.map((k) => publicPart(t.parts.get(k))),
    finalText: t.finalText,
    error: t.error,
    endedAt: t.endedAt,
    tokens: t.tokens,
    model: t.model,
    exitCode: t.exitCode,
    cancelled: !!t.cancelled,
    phase: t.phase,
    source: t.streamSeen ? "stream" : DEMO ? "demo" : "db",
  };
}

function newTurn(question) {
  turnCounter++;
  const id = `t${Date.now().toString(36)}${turnCounter.toString(36)}`;
  const t = {
    id,
    question,
    startedAt: Date.now(),
    status: "running",
    userMsgId: null,
    userMsgAt: 0,
    turnKey: null,
    msgs: new Map(),
    parts: new Map(),
    order: [],
    model: null,
    tokens: null,
    finalText: null,
    error: null,
    endedAt: null,
    exitCode: null,
    child: null,
    poller: null,
    timeout: null,
    stdout: "",
    stderrTail: "",
    cancelled: false,
    timedOut: false,
    // Fuente primaria: eventos stream-json del CLI (token a token). La DB
    // queda como respaldo si el CLI no emite eventos (versión vieja, etc.).
    streamSeen: false,
    partialSeen: false, // claude: llegaron deltas parciales (stream_event)
    lineBuf: "",
    nextOrder: 1,
    openBlock: new Map(), // assistantMessageId → id del bloque text/reasoning abierto
    blockCount: new Map(), // assistantMessageId → contador de bloques
    toolInput: new Map(), // toolCallId → JSON acumulado del input
    streamResponse: null,
    phase: "",
  };
  turn = t;
  emit("turn_start", { turnId: id, question, startedAt: t.startedAt });
  return t;
}

function setPhase(t, text) {
  if (t.status !== "running" || t.phase === text) return;
  t.phase = text;
  emit("phase", { turnId: t.id, text });
}

/** Alta de un bloque (part) del turno con orden de llegada; emite el evento. */
function addStreamPart(t, id, fields) {
  const p = { id, order: t.nextOrder++, at: Date.now(), msgId: fields.msgId || null, ...fields };
  t.parts.set(id, p);
  t.order.push(id);
  emit("part", { turnId: t.id, part: publicPart(p) });
  return p;
}

/** Tokens en el formato del cliente desde el `usage` del CLI. */
function usageToTokens(u) {
  if (!u) return null;
  return {
    input: u.inputTokens || 0,
    output: u.outputTokens || 0,
    total: u.totalTokens || 0,
    cacheRead: u.cacheReadTokens || 0,
  };
}

/**
 * Un evento del stream-json del CLI (una línea NDJSON). Catálogo verificado
 * con zcode 0.16.5:
 *   turn.started {messageId, input} · model.streaming {assistantMessageId,
 *   kind: start|reasoning_start|reasoning_delta|reasoning_end|text_start|
 *   text_delta|text_end|tool_input_start|tool_input_delta|tool_input_end|
 *   tool_call|finish, delta, toolCallId, toolName, input} · tool.updated
 *   {kind: scheduled|started|result|batch, toolCallId, toolName, input,
 *   result:{success, content}, duration} · model_request_started/completed
 *   {model, usage} · turn.completed {response, usage} · turn.failed ·
 *   model.stream.stalled · model.retry.scheduled · result {response, usage}.
 */
function handleStreamEvent(t, ev) {
  if (!ev || typeof ev !== "object") return;
  const type = ev.type;
  const p = ev.payload || {};
  if (type === "result") {
    if (typeof ev.response === "string") t.streamResponse = ev.response;
    if (ev.usage) t.tokens = usageToTokens(ev.usage) || t.tokens;
    if (ev.turnId) t.turnKey = t.turnKey || ev.turnId;
    return;
  }
  if (type === "turn.started") {
    t.streamSeen = true;
    t.turnKey = ev.turnId || t.turnKey;
    if (p.messageId) t.userMsgId = p.messageId;
    setPhase(t, "Turno iniciado · esperando al modelo…");
    return;
  }
  if (type === "session.resumed") {
    setPhase(t, `Sesión retomada (${p.messageCount ?? "?"} mensajes de contexto)…`);
    return;
  }
  if (type === "model_request_started") {
    const m = p.model?.modelId || p.model?.id;
    if (m) t.model = m;
    setPhase(t, `Esperando al modelo${m ? ` ${m}` : ""}…`);
    return;
  }
  if (type === "model_request_completed") {
    if (p.usage) {
      const u = usageToTokens(p.usage);
      t.tokens = t.tokens ? addTokens(t.tokens, { input: u.input, output: u.output, total: u.total, cache: { read: u.cacheRead } }) : u;
    }
    return;
  }
  if (type === "session.updated") {
    const m = p.modelRef?.modelId;
    if (m) t.model = m;
    if (p.hookEventName && !p.outcome) setPhase(t, `Ejecutando hook ${p.hookEventName}…`);
    return;
  }
  if (type === "model.stream.stalled") {
    emit("notice", { turnId: t.id, level: "warn", text: "El modelo dejó de responder por un momento; el CLI está esperando…" });
    return;
  }
  if (type === "model.retry.scheduled") {
    emit("notice", { turnId: t.id, level: "warn", text: `Reintentando la llamada al modelo${p.attempt ? ` (intento ${p.attempt})` : ""}…` });
    return;
  }
  if (type === "turn.completed") {
    if (typeof p.response === "string") t.streamResponse = p.response;
    if (p.usage) t.tokens = usageToTokens(p.usage) || t.tokens;
    return;
  }
  if (type === "turn.failed") {
    t.streamError = p.error?.message || p.message || p.error || "el turno falló";
    if (typeof t.streamError !== "string") t.streamError = JSON.stringify(t.streamError).slice(0, 400);
    return;
  }
  if (type === "tool.updated") {
    const callId = p.toolCallId;
    if (!callId) return;
    const id = `tool:${callId}`;
    let part = t.parts.get(id);
    if (!part) {
      part = addStreamPart(t, id, {
        kind: "tool",
        msgId: p.assistantMessageId || null,
        tool: p.toolName || "herramienta",
        label: toolLabel(p.toolName),
        status: "pending",
        summary: summarizeTool(p.toolName, p.input),
        title: "",
        output: "",
        error: "",
      });
    }
    if (p.kind === "scheduled") {
      if (p.input) part.summary = summarizeTool(part.tool, p.input) || part.summary;
    } else if (p.kind === "started") {
      part.status = "running";
      part.start = p.startedAt || ev.timestamp || Date.now();
      setPhase(t, `${part.label}: ${part.summary || "ejecutando"}…`);
    } else if (p.kind === "result") {
      const ok = p.result?.success !== false;
      part.status = ok ? "completed" : "error";
      part.end = ev.timestamp || Date.now();
      if (!part.start) part.start = part.end - (p.duration || 0);
      const content = typeof p.result?.content === "string" ? p.result.content : p.result?.content != null ? JSON.stringify(p.result.content) : "";
      if (ok) part.output = content.slice(0, 1500);
      else part.error = content.slice(0, 800) || "la herramienta falló";
      setPhase(t, `${part.label} ${ok ? "lista" : "falló"} · el modelo continúa…`);
    } else {
      return; // batch y otros: sin cambios visibles
    }
    emit("part", { turnId: t.id, part: publicPart(part) });
    return;
  }
  if (type !== "model.streaming") return;

  t.streamSeen = true;
  const msgId = p.assistantMessageId || "msg";
  const kind = p.kind;
  const now = ev.timestamp || Date.now();
  const openId = t.openBlock.get(msgId);

  if (kind === "start") {
    if (!t.msgs.has(msgId)) t.msgs.set(msgId, { id: msgId, at: now });
    setPhase(t, "El modelo empezó a responder…");
    return;
  }
  if (kind === "reasoning_start" || kind === "text_start") {
    const blockKind = kind === "reasoning_start" ? "reasoning" : "text";
    // Cerrar cualquier bloque abierto del mismo mensaje.
    if (openId && t.parts.get(openId) && !t.parts.get(openId).end) {
      t.parts.get(openId).end = now;
      emit("part_end", { turnId: t.id, id: openId, end: now });
    }
    const n = (t.blockCount.get(msgId) || 0) + 1;
    t.blockCount.set(msgId, n);
    const id = `${msgId}:${blockKind[0]}${n}`;
    addStreamPart(t, id, { kind: blockKind, msgId, text: "", start: now });
    t.openBlock.set(msgId, id);
    setPhase(t, blockKind === "reasoning" ? "Razonando…" : "Escribiendo la respuesta…");
    return;
  }
  if (kind === "reasoning_delta" || kind === "text_delta") {
    const blockKind = kind === "reasoning_delta" ? "reasoning" : "text";
    let id = openId;
    let part = id ? t.parts.get(id) : null;
    if (!part || part.kind !== blockKind || part.end) {
      // Delta sin start previo (no debería pasar): abrir un bloque igual.
      const n = (t.blockCount.get(msgId) || 0) + 1;
      t.blockCount.set(msgId, n);
      id = `${msgId}:${blockKind[0]}${n}`;
      part = addStreamPart(t, id, { kind: blockKind, msgId, text: "", start: now });
      t.openBlock.set(msgId, id);
    }
    const delta = typeof p.delta === "string" ? p.delta : "";
    if (!delta) return;
    part.text += delta;
    part.updatedAt = now;
    emit("delta", { turnId: t.id, id, delta, end: null });
    return;
  }
  if (kind === "reasoning_end" || kind === "text_end") {
    if (openId && t.parts.get(openId) && !t.parts.get(openId).end) {
      t.parts.get(openId).end = now;
      emit("part_end", { turnId: t.id, id: openId, end: now });
    }
    t.openBlock.delete(msgId);
    return;
  }
  if (kind === "tool_input_start" || kind === "tool_call") {
    const callId = p.toolCallId;
    if (!callId) return;
    const id = `tool:${callId}`;
    let part = t.parts.get(id);
    const input = kind === "tool_call" ? p.input : undefined;
    if (!part) {
      part = addStreamPart(t, id, {
        kind: "tool",
        msgId,
        tool: p.toolName || "herramienta",
        label: toolLabel(p.toolName),
        status: "pending",
        summary: summarizeTool(p.toolName, input),
        title: "",
        output: "",
        error: "",
      });
      setPhase(t, `Preparando ${part.label}…`);
    } else if (input) {
      part.summary = summarizeTool(part.tool, input) || part.summary;
      emit("part", { turnId: t.id, part: publicPart(part) });
    }
    return;
  }
  if (kind === "tool_input_delta") {
    const callId = p.toolCallId;
    if (!callId) return;
    t.toolInput.set(callId, (t.toolInput.get(callId) || "") + (p.delta || ""));
    return;
  }
  if (kind === "tool_input_end") {
    const callId = p.toolCallId;
    const raw = t.toolInput.get(callId);
    const part = t.parts.get(`tool:${callId}`);
    if (raw && part && !part.summary) {
      try {
        part.summary = summarizeTool(part.tool, JSON.parse(raw));
        emit("part", { turnId: t.id, part: publicPart(part) });
      } catch {}
    }
    return;
  }
  if (kind === "finish") {
    // Fin del mensaje del modelo: cerrar lo que quedó abierto.
    if (openId && t.parts.get(openId) && !t.parts.get(openId).end) {
      t.parts.get(openId).end = now;
      emit("part_end", { turnId: t.id, id: openId, end: now });
    }
    t.openBlock.delete(msgId);
  }
}

/** Reparte el stdout del CLI en líneas NDJSON y las despacha. */
function feedStream(t, chunk) {
  t.lineBuf += chunk;
  let idx;
  while ((idx = t.lineBuf.indexOf("\n")) >= 0) {
    const line = t.lineBuf.slice(0, idx).trim();
    t.lineBuf = t.lineBuf.slice(idx + 1);
    if (!line) continue;
    if (line[0] !== "{") continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    try {
      if (AGENT === "claude") handleClaudeStreamEvent(t, ev);
      else handleStreamEvent(t, ev);
    } catch (e) {
      log(`stream event: ${e?.message ?? e}`);
    }
  }
  if (t.lineBuf.length > 4_000_000) t.lineBuf = t.lineBuf.slice(-1_000_000);
}

/**
 * Un evento del stream-json de Claude Code (CLI 2.1.263). Traduce al mismo
 * protocolo de partes que la UI ya consume para ZCode:
 *   system/init {session_id, model} · stream_event (envuelve eventos de la
 *   API: message_start, content_block_start/delta/stop con text, thinking o
 *   tool_use; input_json_delta arma el input de la tool) · assistant
 *   {message completo + usage} · user {tool_result de cada herramienta} ·
 *   result {result, usage, is_error}.
 */
function handleClaudeStreamEvent(t, ev) {
  const type = ev.type;

  if (type === "system" && ev.subtype === "init") {
    t.streamSeen = true;
    if (ev.model) t.model = ev.model;
    setPhase(t, `Sesión de Claude lista${ev.model ? ` (${ev.model})` : ""}…`);
    return;
  }

  if (type === "stream_event") {
    t.partialSeen = true;
    t.streamSeen = true;
    const e = ev.event || {};
    if (e.type === "message_start") {
      const m = e.message?.model;
      if (m) t.model = m;
      setPhase(t, "El modelo empezó a responder…");
      return;
    }
    if (e.type === "content_block_start") {
      const cb = e.content_block || {};
      if (cb.type === "text" || cb.type === "thinking") {
        const kind = cb.type === "thinking" ? "reasoning" : "text";
        const id = `cb${e.index}`;
        addStreamPart(t, id, { kind, text: cb.text || cb.thinking || "", start: Date.now() });
        t.openBlock.set("m", id);
        setPhase(t, kind === "reasoning" ? "Razonando…" : "Escribiendo la respuesta…");
      } else if (cb.type === "tool_use") {
        const id = `tool:${cb.id}`;
        if (!t.parts.get(id)) {
          addStreamPart(t, id, {
            kind: "tool",
            tool: cb.name || "herramienta",
            label: toolLabel(cb.name),
            status: "pending",
            summary: "",
            title: "",
            output: "",
            error: "",
          });
        }
        t.toolInput.set(`idx:${e.index}`, cb.id);
        t.toolInput.set(`json:${cb.id}`, "");
        setPhase(t, `Preparando ${toolLabel(cb.name)}…`);
      }
      return;
    }
    if (e.type === "content_block_delta") {
      const d = e.delta || {};
      if (d.type === "text_delta" || d.type === "thinking_delta") {
        const kind = d.type === "thinking_delta" ? "reasoning" : "text";
        let id = t.openBlock.get("m");
        let part = id ? t.parts.get(id) : null;
        if (!part || part.kind !== kind) {
          id = `cb${e.index}`;
          part = t.parts.get(id);
          if (!part) part = addStreamPart(t, id, { kind, text: "", start: Date.now() });
          t.openBlock.set("m", id);
        }
        if (d.text) {
          part.text += d.text;
          emit("delta", { turnId: t.id, id, delta: d.text, end: null });
        }
      } else if (d.type === "input_json_delta") {
        const callId = t.toolInput.get(`idx:${e.index}`);
        if (callId) t.toolInput.set(`json:${callId}`, (t.toolInput.get(`json:${callId}`) || "") + (d.partial_json || ""));
      }
      return;
    }
    if (e.type === "content_block_stop") {
      const callId = t.toolInput.get(`idx:${e.index}`);
      if (callId) {
        const raw = t.toolInput.get(`json:${callId}`);
        const part = t.parts.get(`tool:${callId}`);
        if (raw && part) {
          try {
            part.summary = summarizeTool(part.tool, JSON.parse(raw));
          } catch {
            part.summary = raw.slice(0, 140);
          }
          part.status = "running";
          part.start = part.start || Date.now();
          emit("part", { turnId: t.id, part: publicPart(part) });
          setPhase(t, `${part.label}: ${part.summary || "ejecutando"}…`);
        }
        return;
      }
      const openId = t.openBlock.get("m");
      const op = openId ? t.parts.get(openId) : null;
      if (op && !op.end) {
        op.end = Date.now();
        emit("part_end", { turnId: t.id, id: openId, end: op.end });
      }
    }
    return;
  }

  if (type === "assistant") {
    t.streamSeen = true;
    const msg = ev.message || {};
    if (msg.model) t.model = msg.model;
    if (msg.usage) {
      const u = msg.usage;
      const tk = {
        input: u.input_tokens || 0,
        output: u.output_tokens || 0,
        total: (u.input_tokens || 0) + (u.output_tokens || 0),
        cacheRead: u.cache_read_input_tokens || 0,
      };
      t.tokens = t.tokens ? addTokens(t.tokens, tk) : tk;
    }
    // Sin deltas parciales (CLI sin --include-partial-messages): las partes
    // completas del mensaje llegan acá — alta con granularidad por bloque.
    if (!t.partialSeen) {
      let order = 0;
      for (const c of msg.content ?? []) {
        if (c?.type === "text" && (c.text ?? "").trim()) {
          addStreamPart(t, `${ev.uuid || "a"}:t${order}`, { kind: "text", text: c.text });
        } else if (c?.type === "thinking" && (c.thinking ?? "").trim()) {
          addStreamPart(t, `${ev.uuid || "a"}:r${order}`, { kind: "reasoning", text: c.thinking });
        } else if (c?.type === "tool_use") {
          addStreamPart(t, `tool:${c.id}`, {
            kind: "tool",
            tool: c.name || "herramienta",
            label: toolLabel(c.name),
            status: "running",
            summary: summarizeTool(c.name, c.input),
            title: "",
            output: "",
            error: "",
          });
        }
        order++;
      }
    }
    return;
  }

  if (type === "user") {
    // tool_result → cierra el bloque de la herramienta con su salida.
    const content = ev.message?.content;
    if (!Array.isArray(content)) return;
    for (const c of content) {
      if (c?.type !== "tool_result" || !c.tool_use_id) continue;
      const part = t.parts.get(`tool:${c.tool_use_id}`);
      if (!part) continue;
      const res = typeof c.content === "string"
        ? c.content
        : Array.isArray(c.content)
          ? c.content.map((x) => x?.text ?? "").join("\n")
          : "";
      part.end = Date.now();
      if (c.is_error) {
        part.status = "error";
        part.error = String(res).slice(0, 800) || "la herramienta falló";
      } else {
        part.status = "completed";
        part.output = String(res).slice(0, 1500);
      }
      emit("part", { turnId: t.id, part: publicPart(part) });
      setPhase(t, `${part.label} ${part.status === "error" ? "falló" : "lista"} · el modelo continúa…`);
    }
    return;
  }

  if (type === "result") {
    t.streamSeen = true;
    if (typeof ev.result === "string") t.streamResponse = ev.result;
    if (ev.usage) {
      const u = ev.usage;
      t.tokens = t.tokens || {
        input: 0,
        output: 0,
        total: 0,
        cacheRead: 0,
      };
      t.tokens.input += u.input_tokens || 0;
      t.tokens.output += u.output_tokens || 0;
      t.tokens.total += (u.input_tokens || 0) + (u.output_tokens || 0);
      t.tokens.cacheRead += u.cache_read_input_tokens || 0;
    }
    if (ev.is_error && !t.streamError) {
      t.streamError = typeof ev.result === "string" && ev.result ? ev.result : "el turno falló";
    }
  }
}

/**
 * RESPALDO: un barrido de la DB de sesiones (mensajes del turno y sus parts)
 * emitiendo lo que cambió. En headless el CLI persiste cada mensaje al cerrar
 * el paso (no token a token), así que esto solo se usa si el stream-json de
 * stdout no emitió nada (CLI viejo o flag no soportado): peor granularidad,
 * pero la respuesta llega igual.
 */
function pollTurn(t) {
  if (t.streamSeen) return;
  // Claude: el stream-json SIEMPRE emite (assistant/result completos aunque no
  // haya parciales) — el respaldo por DB no aplica; el texto final sale del
  // evento result del stdout.
  if (AGENT === "claude") return;
  safeQuery((d) => {
    const since = t.startedAt - 5000;
    const msgs = d
      .prepare(
        "SELECT id, time_created, data FROM message WHERE session_id = ? AND time_created >= ? ORDER BY sequence, time_created",
      )
      .all(sessionId, since);
    const getParts = d.prepare(
      "SELECT id, sequence, time_created, time_updated, data FROM part WHERE message_id = ? ORDER BY sequence",
    );

    // 1) Identificar NUESTRO mensaje user (por el texto de la pregunta).
    if (!t.userMsgId) {
      const needle = t.question.slice(0, 80);
      for (const m of msgs) {
        let md;
        try {
          md = JSON.parse(m.data);
        } catch {
          continue;
        }
        if (md.role !== "user" || md.synthetic) continue;
        const txt = getParts
          .all(m.id)
          .map((p) => {
            try {
              const pd = JSON.parse(p.data);
              return pd.type === "text" ? pd.text || "" : "";
            } catch {
              return "";
            }
          })
          .join("\n");
        if (txt.includes(needle)) {
          t.userMsgId = m.id;
          t.userMsgAt = m.time_created;
          t.turnKey = md.anchor?.turnId || null;
          break;
        }
      }
      if (!t.userMsgId) return;
    }

    // 2) Mensajes assistant de ESTE turno (turnId o parentID; nunca de otra corrida).
    for (const m of msgs) {
      let md;
      try {
        md = JSON.parse(m.data);
      } catch {
        continue;
      }
      if (md.role !== "assistant") continue;
      const mine =
        t.msgs.has(m.id) ||
        (t.turnKey ? md.anchor?.turnId === t.turnKey : false) ||
        md.parentID === t.userMsgId ||
        (!t.turnKey && !md.anchor?.turnId && m.time_created >= t.userMsgAt);
      if (!mine) continue;
      let meta = t.msgs.get(m.id);
      if (!meta) {
        meta = { id: m.id, at: m.time_created, tokens: null };
        t.msgs.set(m.id, meta);
      }
      meta.completed = md.time?.completed;
      meta.finish = md.finish;
      if (md.modelID) t.model = md.modelID;
      if (md.error && !meta.error) {
        meta.error = typeof md.error === "string" ? md.error : md.error?.message || JSON.stringify(md.error).slice(0, 400);
        emit("notice", { turnId: t.id, level: "warn", text: `El modelo reportó un error: ${meta.error}` });
      }

      // 3) Parts: alta, deltas de texto/razonamiento, cambios de estado de tools.
      let msgTokens = null;
      for (const p of getParts.all(m.id)) {
        let b;
        try {
          b = blockFrom(p);
        } catch {
          continue;
        }
        if (!b) continue;
        if (b.kind === "step") {
          msgTokens = addTokens(msgTokens, b.tokens);
          continue;
        }
        const key = p.id;
        const prev = t.parts.get(key);
        if (!prev) {
          const np = { ...b, msgId: m.id };
          t.parts.set(key, np);
          t.order.push(key);
          emit("part", { turnId: t.id, part: publicPart(np) });
          continue;
        }
        if (b.kind === "text" || b.kind === "reasoning") {
          if (b.text !== prev.text) {
            if (b.text.startsWith(prev.text)) {
              emit("delta", { turnId: t.id, id: key, delta: b.text.slice(prev.text.length), end: b.end ?? null });
            } else {
              emit("part", { turnId: t.id, part: publicPart({ ...prev, ...b, msgId: m.id }) });
            }
            prev.text = b.text;
            prev.updatedAt = b.updatedAt;
          }
          if (b.end && !prev.end) {
            prev.end = b.end;
            emit("part_end", { turnId: t.id, id: key, end: b.end });
          }
        } else if (b.kind === "tool") {
          if (
            b.status !== prev.status ||
            b.summary !== prev.summary ||
            b.output !== prev.output ||
            b.error !== prev.error ||
            b.title !== prev.title
          ) {
            Object.assign(prev, b, { msgId: m.id });
            emit("part", { turnId: t.id, part: publicPart(prev) });
          }
        }
      }
      if (msgTokens) meta.tokens = msgTokens;
    }
    // Tokens del turno = suma de los mensajes.
    let total = null;
    for (const meta of t.msgs.values()) if (meta.tokens) total = addTokens(total, meta.tokens);
    if (total) t.tokens = total;
  });
}

function finishTurn(t, { code = null, error = null } = {}) {
  if (t.status !== "running") return;
  clearInterval(t.poller);
  clearTimeout(t.timeout);
  if (!DEMO) {
    if (t.lineBuf.trim()) feedStream(t, "\n"); // última línea sin salto
    pollTurn(t); // (solo respaldo sin stream) barrido final de la DB
  }
  t.endedAt = Date.now();
  t.exitCode = code;
  // Cerrar bloques que quedaron abiertos (p.ej. cancelación a mitad).
  for (const p of t.parts.values()) {
    if ((p.kind === "text" || p.kind === "reasoning") && !p.end) {
      p.end = t.endedAt;
      emit("part_end", { turnId: t.id, id: p.id, end: p.end });
    }
    if (p.kind === "tool" && (p.status === "running" || p.status === "pending")) {
      p.status = t.cancelled ? "error" : p.status;
      if (t.cancelled) {
        p.error = "cancelada";
        emit("part", { turnId: t.id, part: publicPart(p) });
      }
    }
  }
  const streamed = t.order
    .map((k) => t.parts.get(k))
    .filter((p) => p.kind === "text" && p.text.trim())
    .map((p) => p.text.trim())
    .join("\n\n");
  // Texto autoritativo: respuesta del CLI (turn.completed/result) → bloques
  // streameados → respuesta del stdout JSON legado.
  const fromDb = t.streamResponse?.trim() || streamed;
  let fromStdout = null;
  if (!t.streamSeen) {
    if (AGENT === "claude") {
      fromStdout = adapter.extractResponse(t.stdout);
    } else {
      try {
        const j = JSON.parse(t.stdout);
        if (typeof j.response === "string") fromStdout = j.response;
        if (j.error && !error) error = typeof j.error === "string" ? j.error : JSON.stringify(j.error).slice(0, 400);
      } catch {}
    }
  }
  if (t.streamError && !error && !fromDb) error = t.streamError;
  const durationMs = t.endedAt - t.startedAt;

  if (t.cancelled) {
    t.status = "cancelled";
    t.finalText = fromDb || "";
    emit("turn_done", {
      turnId: t.id,
      text: t.finalText,
      cancelled: true,
      endedAt: t.endedAt,
      durationMs,
      tokens: t.tokens,
      model: t.model,
      exitCode: code,
    });
    log(`turno ${t.id} cancelado (${Math.round(durationMs / 1000)}s)`);
  } else if (t.timedOut) {
    t.status = "error";
    t.error = `La respuesta superó el tiempo máximo (${Math.round(TURN_TIMEOUT_MS / 60000)} min) y se detuvo.`;
    emit("turn_error", { turnId: t.id, error: t.error, partialText: fromDb, endedAt: t.endedAt, durationMs });
    log(`turno ${t.id} timeout`);
  } else if (error || (code !== 0 && !fromDb && !fromStdout)) {
    t.status = "error";
    const tail = t.stderrTail.trim().slice(-300);
    t.error = error || `${adapter.label} terminó con código ${code}${tail ? ` — ${tail}` : ""}`;
    emit("turn_error", { turnId: t.id, error: t.error, partialText: fromDb, endedAt: t.endedAt, durationMs });
    log(`turno ${t.id} error: ${t.error}`);
  } else {
    t.status = "done";
    t.finalText = fromDb || fromStdout || "";
    emit("turn_done", {
      turnId: t.id,
      text: t.finalText,
      endedAt: t.endedAt,
      durationMs,
      tokens: t.tokens,
      model: t.model,
      exitCode: code,
    });
    log(
      `turno ${t.id} ok (exit ${code}, ${Math.round(durationMs / 1000)}s, ${t.finalText.length} chars, ${t.parts.size} bloques, fuente ${
        t.streamSeen ? "stream-json" : "db"
      })`,
    );
  }
  t.child = null;
}

function contextoTracker() {
  const st = tracker.task?.status || taskStatus;
  const ag = tracker.task?.agentState || taskAgentState;
  if (!st && !ag) return "";
  const hora = new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  const extra = [];
  if (tracker.live && tracker.run?.plan?.length) {
    extra.push(`plan de ${tracker.run.plan.length} pasos, ${tracker.run.doneCount} reportados`);
  }
  if (tracker.task?.question && ag === "pregunta") extra.push(`pregunta abierta: "${tracker.task.question.slice(0, 160)}"`);
  return `[CONTEXTO ACTUALIZADO DEL TRACKER HERMES — prioriza esto sobre tus recuerdos: la tarea está en estado '${st || "?"}'${
    ag ? `, delegación '${ag}'` : ""
  }${extra.length ? ` (${extra.join("; ")})` : ""} a las ${hora}.]\n`;
}

function runTurn(t) {
  if (DEMO) return simulateTurn(t);
  // Prefijo según modo: consulta (read-only) o riendas (ejecución real).
  const prefix = execMode
    ? `${EXEC_PREFIX}ejecuta lo que Cris pida y cuéntale qué hiciste (con evidencia: archivos, comandos, números). Esto NO es una corrida del dispatcher: no reportes por report.mjs. `
    : ASK_PREFIX;
  const prompt = `${prefix}${contextoTracker()}${t.question}`;
  let child;
  if (AGENT === "claude") {
    // Claude: read-only (plan) o riendas (bypassPermissions); cwd = carpeta de
    // trabajo (no existe --cwd). stream-json + parciales = razonamiento token
    // a token.
    const args = [
      "-p",
      prompt,
      "--resume",
      sessionId,
      "--permission-mode",
      execMode ? "bypassPermissions" : "plan",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ];
    try {
      child = spawn(adapter.exe, args, {
        cwd: workspacePath,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (e) {
      finishTurn(t, { error: `no pude lanzar Claude Code: ${e?.message ?? e}` });
      return;
    }
  } else {
    // --output-format stream-json: el CLI escribe en stdout un evento NDJSON por
    // token (model.streaming), por herramienta (tool.updated) y al final
    // (turn.completed + result). Es la única forma de ver el razonamiento EN
    // VIVO en headless: la DB solo se persiste al cerrar cada paso.
    const args = [
      ZCODE_CLI,
      "-p",
      prompt,
      "--resume",
      sessionId,
      "--cwd",
      workspacePath,
      "--mode",
      execMode ? "yolo" : "plan",
      "--output-format",
      "stream-json",
    ];
    try {
      child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (e) {
      finishTurn(t, { error: `no pude lanzar ZCode: ${e?.message ?? e}` });
      return;
    }
  }
  t.child = child;
  setPhase(t, `Lanzando ${adapter.label} y retomando la sesión…`);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    // Copia cruda acotada (diagnóstico / fallback --json) + parser NDJSON.
    t.stdout += d;
    if (t.stdout.length > 4_000_000) t.stdout = t.stdout.slice(-2_000_000);
    feedStream(t, d);
  });
  child.stderr.on("data", (d) => {
    const s = String(d).trim();
    if (!s) return;
    log(`stderr: ${s.slice(0, 300)}`);
    t.stderrTail = (t.stderrTail + "\n" + s).slice(-2000);
  });
  t.poller = setInterval(() => pollTurn(t), POLL_MS);
  t.timeout = setTimeout(() => {
    t.timedOut = true;
    try {
      child.kill();
    } catch {}
  }, TURN_TIMEOUT_MS);
  child.on("error", (e) => finishTurn(t, { error: `no pude lanzar ${adapter.label}: ${e?.message ?? e}` }));
  child.on("close", (code) => {
    // Pequeña espera: el CLI cierra el proceso justo después de persistir.
    setTimeout(() => finishTurn(t, { code }), 350);
  });
}

function cancelTurn() {
  if (!turn || turn.status !== "running") return false;
  turn.cancelled = true;
  if (turn.child) {
    try {
      turn.child.kill();
    } catch {}
  } else {
    finishTurn(turn, { code: null });
  }
  return true;
}

// ---- Modo demo: turno simulado (para probar la UI sin gastar tokens) ----
function simulateTurn(t) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const chunks = (s, min = 2, max = 9) => {
    const out = [];
    let i = 0;
    while (i < s.length) {
      const n = min + Math.floor(Math.random() * (max - min));
      out.push(s.slice(i, i + n));
      i += n;
    }
    return out;
  };
  const addPart = (p) => {
    t.parts.set(p.id, { ...p, msgId: "demo" });
    t.order.push(p.id);
    emit("part", { turnId: t.id, part: publicPart(t.parts.get(p.id)) });
  };
  const stream = async (id, text, pace) => {
    const p = t.parts.get(id);
    for (const c of chunks(text)) {
      if (t.status !== "running") return;
      p.text += c;
      emit("delta", { turnId: t.id, id, delta: c, end: null });
      await sleep(pace + Math.random() * pace);
    }
    p.end = Date.now();
    emit("part_end", { turnId: t.id, id, end: p.end });
  };
  (async () => {
    t.model = "GLM-5.3-Flash (demo)";
    await sleep(700);
    addPart({ id: "demo-r1", kind: "reasoning", order: 1, text: "", at: Date.now(), start: Date.now() });
    await stream(
      "demo-r1",
      "Cris pregunta por el filtro aplicado en Transacciones. Tengo el contexto de la corrida: edité 6 medidas con LEDGERACCOUNT<>400004 y dejé backup en backups/. Antes de responder conviene releer CAMBIOS.md para citar los números exactos de antes/después y no inventar nada. El tracker dice que la tarea ya está completada, así que no debo decir que sigue en para-revisión.\n\nPlan de respuesta: (1) confirmar el filtro exacto, (2) listar las medidas tocadas, (3) dar el número de validación y (4) recordar el rollback.",
      28,
    );
    if (t.status !== "running") return;
    addPart({
      id: "demo-t1",
      kind: "tool",
      order: 2,
      tool: "Read",
      label: "Read",
      status: "running",
      summary: "CAMBIOS.md",
      at: Date.now(),
      start: Date.now(),
    });
    await sleep(1300);
    Object.assign(t.parts.get("demo-t1"), {
      status: "completed",
      end: Date.now(),
      output: "## 2026-09-04 — Filtro LEDGERACCOUNT<>400004\n- Medidas: Transacciones, Transacciones AA, Ticket promedio, Ticket promedio AA, Unidades por ticket, Unidades por ticket AA\n- Validación: 1.284.311 → 1.279.902 transacciones (−4.409 filas de reparaciones)\n- Backup: backups/Resumen Kpis comerciales_2026-09-04.pbix",
    });
    emit("part", { turnId: t.id, part: publicPart(t.parts.get("demo-t1")) });
    await sleep(400);
    addPart({
      id: "demo-t2",
      kind: "tool",
      order: 3,
      tool: "mcp__powerbi-modeling-mcp__dax_query_operations",
      label: toolLabel("mcp__powerbi-modeling-mcp__dax_query_operations"),
      status: "running",
      summary: "EVALUATE ROW(\"n\", [Transacciones])",
      at: Date.now(),
      start: Date.now(),
    });
    await sleep(1600);
    Object.assign(t.parts.get("demo-t2"), { status: "completed", end: Date.now(), output: "n\n1279902" });
    emit("part", { turnId: t.id, part: publicPart(t.parts.get("demo-t2")) });
    await sleep(300);
    addPart({ id: "demo-x1", kind: "text", order: 4, text: "", at: Date.now(), start: Date.now() });
    await stream(
      "demo-x1",
      "El filtro que apliqué en **Transacciones** (y en sus 5 medidas hermanas) es `LEDGERACCOUNT <> 400004`: excluye la cuenta de **reparaciones**, que no es venta y estaba inflando el conteo.\n\n### Medidas tocadas\n1. Transacciones · Transacciones AA\n2. Ticket promedio · Ticket promedio AA\n3. Unidades por ticket · Unidades por ticket AA\n\n### Validación\n| Medida | Antes | Después |\n|---|---|---|\n| Transacciones | 1.284.311 | 1.279.902 |\n| Diferencia | | −4.409 (reparaciones) |\n\nLo verifiqué recién con una consulta DAX en vivo: `1.279.902`, igual que lo documentado en `CAMBIOS.md`.\n\n> Rollback disponible: `backups\\Resumen Kpis comerciales_2026-09-04.pbix`.\n\nSi querés, el siguiente paso natural sería sacar reparaciones también del numerador del ticket promedio — hoy sigue adentro ($5,4M histórico).",
      22,
    );
    if (t.status !== "running") return;
    t.tokens = { input: 119708, output: 952, total: 120660, cacheRead: 105920 };
    t.stdout = JSON.stringify({ response: t.parts.get("demo-x1").text });
    finishTurn(t, { code: 0 });
  })().catch((e) => finishTurn(t, { error: `demo: ${e?.message ?? e}` }));
}

// ---- HTTP ----
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}
function serveStatic(res, name) {
  const file = path.normalize(path.join(UI_DIR, name));
  if (!file.startsWith(UI_DIR) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  res.end(readFileSync(file));
}
function readBody(req, limit = 64_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (d) => {
      body += d;
      if (body.length > limit) {
        reject(new Error("body demasiado grande"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
function info(port) {
  return {
    app: "zchat",
    version: VERSION,
    pid: process.pid,
    port,
    agent: AGENT,
    agentLabel: adapter.label,
    session: sessionId,
    title: sessionTitle,
    folder: workspacePath,
    task: taskId || null,
    theme: themeHint || null,
    demo: DEMO,
    observer,
    exec: execMode,
    startedAt: SERVER_STARTED_AT,
  };
}
const SERVER_STARTED_AT = Date.now();
let listeningPort = 0;

async function handler(req, res) {
  lastActivity = Date.now();
  const url = new URL(req.url, "http://127.0.0.1");
  const p = url.pathname;
  try {
    if (req.method === "GET") {
      if (p === "/" || p === "/index.html") return serveStatic(res, "index.html");
      if (p === "/app.css" || p === "/app.js" || p === "/logo.svg" || p === "/favicon.svg")
        return serveStatic(res, p.slice(1));
      if (p === "/info") return json(res, 200, info(listeningPort));
      if (p === "/history") return json(res, 200, readHistory());
      if (p === "/state") {
        return json(res, 200, { info: info(listeningPort), tracker, turn: snapshotTurn(turn), seq, observer, exec: execMode, sessionReady: !!sessionId, now: Date.now() });
      }
      if (p === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write(`retry: 1500\n:ok\n\n`);
        const sinceRaw = req.headers["last-event-id"] ?? url.searchParams.get("since");
        const since = sinceRaw != null && sinceRaw !== "" ? Number(sinceRaw) : null;
        if (since != null && Number.isFinite(since)) {
          if (since > seq || (events.length && since < events[0].seq - 1)) {
            // El cliente tiene una historia que ya no podemos reconstruir: que recargue /state.
            res.write(`event: resync\ndata: ${JSON.stringify({ seq })}\n\n`);
          } else {
            for (const ev of events) {
              if (ev.seq > since) res.write(`id: ${ev.seq}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
            }
          }
        }
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }
      res.writeHead(404);
      return res.end();
    }
    if (req.method === "POST") {
      if (p === "/ask") {
        if (turn && turn.status === "running") {
          return json(res, 409, { error: "Ya hay una respuesta en curso. Esperá a que termine o detenela.", turnId: turn.id });
        }
        // Sesión pendiente: todavía no hay sesión a la que preguntar.
        if (!sessionId) {
          return json(res, 409, {
            error:
              "El agente todavía no arrancó su sesión (acaba de despacharse). Espera unos segundos: el historial aparece solo en cuanto arranca.",
            pendingSession: true,
          });
        }
        // Modo observador: la corrida del dispatcher está activa sobre esta
        // sesión; dos procesos se pisarían. Se puede MIRAR, no preguntar.
        if (observer) {
          return json(res, 409, {
            error:
              "La corrida del agente está ACTIVA: el chat está en modo observador (ves el razonamiento en vivo). Cuando termine podrás preguntar.",
            observer: true,
          });
        }
        let question = "";
        try {
          question = String(JSON.parse(await readBody(req)).q || "")
            .replace(/\r\n/g, "\n")
            .trim()
            .slice(0, 6000);
        } catch {}
        if (!question) return json(res, 400, { error: "La pregunta está vacía." });
        log(`pregunta${execMode ? " [EJECUCIÓN]" : ""}: ${question.slice(0, 140).replace(/\n/g, " ")}`);
        const t = newTurn(question);
        runTurn(t);
        return json(res, 202, { turnId: t.id, question: t.question, startedAt: t.startedAt });
      }
      if (p === "/mode") {
        // Modo ejecución (riendas): toggle explícito de Cris. La UI pide
        // confirmación antes de activarlo; acá solo se refleja el estado.
        // Es un modo peligroso: se exige un booleano estricto y ante cualquier
        // duda (body roto, "false", ausente) NO se activa nada.
        let exec = null;
        try {
          const body = JSON.parse(await readBody(req));
          if (typeof body?.exec === "boolean") exec = body.exec;
        } catch {}
        if (exec === null)
          return json(res, 400, { error: "Falta 'exec' booleano.", exec: execMode });
        execMode = exec;
        emit("mode", { exec: execMode });
        log(`modo ${execMode ? "EJECUCIÓN (riendas)" : "consulta (solo lectura)"}`);
        return json(res, 200, { exec: execMode });
      }
      if (p === "/cancel") {
        const ok = cancelTurn();
        return json(res, 200, { ok, turnId: turn?.id ?? null });
      }
      if (p === "/quit") {
        json(res, 200, { ok: true });
        log("cerrado desde la UI — chau");
        setTimeout(shutdown, 250);
        return;
      }
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(405);
    res.end();
  } catch (e) {
    log(`handler ${p}: ${e?.message ?? e}`);
    try {
      json(res, 500, { error: "error interno del servidor de chat" });
    } catch {}
  }
}

function shutdown() {
  try {
    if (turn?.child) turn.child.kill();
  } catch {}
  if (observerPoller) clearInterval(observerPoller);
  try {
    trackerClient?.close();
  } catch {}
  dbReset();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  try {
    if (turn?.child) turn.child.kill();
  } catch {}
});
process.on("uncaughtException", (e) => log(`uncaught: ${e?.stack ?? e}`));
process.on("unhandledRejection", (e) => log(`unhandled: ${e?.stack ?? e}`));

function openBrowser(url) {
  if (NO_OPEN) return;
  try {
    spawn("cmd", ["/c", "start", "", url], { windowsHide: true, detached: true, stdio: "ignore" }).unref();
  } catch (e) {
    log(`no pude abrir el navegador: ${e?.message ?? e}`);
  }
}

/** ¿Ya hay un zchat-server para ESTA sesión (o tarea, si la sesión espera)? */
async function findExisting() {
  for (let port = PORT_BASE; port < PORT_BASE + PORT_SPAN; port++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 350);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/info`, { signal: ctl.signal });
      if (!r.ok) continue;
      const j = await r.json();
      if (j?.app !== "zchat") continue;
      if (sessionId && j.session === sessionId) return port;
      // Sesión pendiente: matchear por tarea (mismo chat de la misma tarea).
      if (!sessionId && taskId && j.task === taskId) return port;
    } catch {
      // puerto libre o no es nuestro
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

const serverInst = http.createServer((req, res) => void handler(req, res));
const listen = (port) =>
  new Promise((resolve, reject) => {
    const onErr = (e) => {
      serverInst.off("listening", onOk);
      reject(e);
    };
    const onOk = () => {
      serverInst.off("error", onErr);
      resolve();
    };
    serverInst.once("error", onErr);
    serverInst.once("listening", onOk);
    serverInst.listen(port, "127.0.0.1");
  });

(async () => {
  const existing = await findExisting();
  if (existing) {
    const url = `http://127.0.0.1:${existing}/`;
    log(`ya hay un chat para ${sessionId} en ${url} — lo abro y salgo`);
    openBrowser(url);
    process.exit(0);
  }
  for (let i = 0; i < PORT_SPAN; i++) {
    const port = PORT_BASE + i;
    try {
      await listen(port);
      listeningPort = port;
      break;
    } catch {
      if (i === PORT_SPAN - 1) {
        log("sin puertos libres");
        process.exit(1);
      }
    }
  }
  const url = `http://127.0.0.1:${listeningPort}/`;
  log(`arriba en ${url} · sesión ${sessionId} · ${workspacePath}${taskId ? ` · tarea ${taskId}` : ""}${DEMO ? " · DEMO" : ""}`);
  openBrowser(url);
  void startTracker();
  setInterval(() => {
    // Keep-alive del SSE (comentario: no genera evento en el cliente).
    for (const res of sseClients) {
      try {
        res.write(`:ping ${Date.now()}\n\n`);
      } catch {
        sseClients.delete(res);
      }
    }
  }, 15_000).unref();
  setInterval(() => {
    const running = turn && turn.status === "running";
    if (!running && Date.now() - lastActivity > IDLE_MS) {
      log("idle timeout — chau");
      shutdown();
    }
  }, 60_000).unref();
})();
