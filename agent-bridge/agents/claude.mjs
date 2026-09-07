/**
 * Adaptador del agente Claude Code para el dispatcher y el chat.
 *
 * Verificado contra el CLI 2.1.263 (cuenta Enterprise, headless, Windows):
 *  - Spawn: claude.exe -p <prompt> [--resume <uuid>] --permission-mode
 *    bypassPermissions [--model <alias>] [--effort high]
 *    --output-format stream-json --verbose   (cwd = carpeta de trabajo).
 *  - Sesión: llega en el PRIMER evento (system/init → session_id, uuid v4) y
 *    persiste como <uuid>.jsonl en ~/.claude/projects/<cwd-codificado>/.
 *  -- resume: mantiene TODO el contexto (verificado).
 *  - Autonomía: sin TTY los modos con permisos se cuelgan → las tres
 *    autonomías mapean a bypassPermissions (misma lección que zcode/yolo).
 *  - Modelos: por FLAG (no hay swap global): "claude/sonnet-5-high" →
 *    --model sonnet --effort high. Sin modelo → default de la cuenta.
 *  - Actividad en vivo: el stream-json ya emite los eventos del asistente
 *    (tool_use/texto) — no hace falta tailer.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CLAUDE_CLI, CLAUDE_PROJECTS_DIR, CLAUDE_SETTINGS } from "../config.mjs";

/** Codifica un cwd como lo hace Claude: C:\a\b → C--a-b. */
function encodeCwd(cwd) {
  return String(cwd).replace(/[:.]/g, "").replace(/[\\/]/g, "-");
}

/** Ruta del JSONL de una sesión (busca en todos los proyectos por si movió). */
function sessionFile(sessionId, cwdHint) {
  const names = cwdHint ? [encodeCwd(cwdHint)] : [];
  try {
    for (const d of readdirSync(CLAUDE_PROJECTS_DIR)) {
      if (!names.includes(d)) names.push(d);
    }
  } catch {
    // sin projects dir
  }
  for (const d of names) {
    const f = path.join(CLAUDE_PROJECTS_DIR, d, `${sessionId}.jsonl`);
    if (existsSync(f)) return f;
  }
  return null;
}

/** ¿La sesión existe en disco? (mejor esfuerzo: sin ~/.claude → no hay resume). */
function sessionAliveInFs(sessionId) {
  return !!sessionFile(sessionId);
}

/**
 * Id interno del tracker → flags del CLI.
 * "claude/sonnet-5-high" → { model: "sonnet", effort: "high" }
 * "claude/opus-5-high"   → { model: "opus",   effort: "high" }
 * Cualquier otro valor pasa verbatim como --model (permite ids custom); si
 * trae el prefijo "claude/" se lo saca antes, porque el CLI no lo entiende.
 */
export function claudeModelFlags(model) {
  if (!model) return {};
  if (!model.startsWith("claude/")) return { model };
  const rest = model.slice("claude/".length);
  const m = rest.match(/^(sonnet|opus|haiku)(?:-[\d.]+)?(?:-(low|medium|high|xhigh|max))?$/);
  // Id custom bajo el prefijo (p. ej. "claude/claude-opus-5"): va tal cual al
  // CLI sin el prefijo interno del tracker.
  if (!m) return rest ? { model: rest } : {};
  return { model: m[1], ...(m[2] ? { effort: m[2] } : {}) };
}

/** Catálogo Claude: default de la cuenta (settings.json) + picks de Cris. */
function readClaudeCatalog() {
  let def = "";
  try {
    const cfg = JSON.parse(readFileSync(CLAUDE_SETTINGS, "utf8"));
    if (typeof cfg.model === "string" && cfg.model) def = cfg.model;
  } catch {
    // sin settings → sin default conocido
  }
  return {
    models: [
      { id: "claude/sonnet-5-high", label: "Sonnet 5 High" },
      { id: "claude/opus-5-high", label: "Opus 5 High" },
    ],
    default: def,
  };
}

/** Descripción corta de la última acción de un mensaje asistente del stream. */
function describeAssistant(obj) {
  const content = obj?.message?.content;
  if (!Array.isArray(content)) return null;
  let desc = null;
  for (const b of content) {
    if (b?.type === "tool_use") {
      const k = Object.keys(b.input ?? {})[0] ?? "";
      const v = String(b.input?.[k] ?? "").replace(/\s+/g, " ").trim();
      desc = `${b.name}: ${k}=${v}`.slice(0, 160);
    } else if (b?.type === "text" && (b.text ?? "").trim().length >= 10) {
      desc = b.text.replace(/\s+/g, " ").trim().slice(0, 160);
    }
  }
  return desc;
}

export const claudeAdapter = {
  id: "claude",
  label: "Claude Code",
  /** Ejecutable (binario nativo; spawn directo, sin shell). */
  exe: CLAUDE_CLI,

  /** Spawn: claude.exe -p ... (cwd = carpeta de trabajo; no existe --cwd). */
  buildSpawn({ prompt, sessionId, folder, model, env }) {
    const flags = claudeModelFlags(model);
    return {
      exe: CLAUDE_CLI,
      args: [
        "-p",
        prompt,
        ...(sessionId ? ["--resume", sessionId] : []),
        "--permission-mode",
        "bypassPermissions",
        ...(flags.model ? ["--model", flags.model] : []),
        ...(flags.effort ? ["--effort", flags.effort] : []),
        "--output-format",
        "stream-json",
        "--verbose",
      ],
      options: { cwd: folder, env, windowsHide: true },
    };
  },

  /** stream-json: el session_id llega en system/init (se captura en vivo). */
  extractSessionId(run, stdout) {
    if (run?.sessionId) return run.sessionId;
    const m = String(stdout).match(/"session_id":\s*"([0-9a-f-]{36})"/);
    return m ? m[1] : null;
  },

  /** El texto final vive en el evento result (última línea del stream). */
  extractResponse(stdout) {
    for (const line of String(stdout).split("\n").reverse()) {
      if (!line.trim().startsWith("{")) continue;
      try {
        const j = JSON.parse(line);
        if (j.type === "result" && typeof j.result === "string") return j.result;
      } catch {
        // línea parcial
      }
    }
    return null;
  },

  /**
   * Eventos en vivo del stream-json: session_id temprano (bind inmediato,
   * aunque el proceso muera después) + actividad del asistente.
   */
  onStdoutLine(run, line, api) {
    const s = String(line);
    if (!s.trim().startsWith("{")) return;
    let j;
    try {
      j = JSON.parse(s);
    } catch {
      return;
    }
    if (j.type === "system" && j.subtype === "init" && j.session_id) {
      run.sessionId = j.session_id;
      api.bindSession(j.session_id);
      return;
    }
    if (j.type === "assistant") {
      const desc = describeAssistant(j);
      if (desc) {
        run.lastActivityAt = Date.now();
        api.activity(desc);
      }
    }
  },

  /** La actividad sale del propio stdout: no hace falta tailer. */
  startTailer() {
    return null;
  },

  sessionAlive: sessionAliveInFs,
  /** Ruta del JSONL de la sesión (la usa el chat para el historial). */
  sessionFile,
  /** Bind temprano: no hace falta — el session_id llega en system/init. */
  watchSession() {
    return null;
  },

  modelCatalog: readClaudeCatalog,

  /** El modelo va por flag: nunca hay swap de config global. */
  needsSwap() {
    return false;
  },
  swap() {
    return null;
  },

  effectiveModel(task) {
    return task.model || "";
  },
};
