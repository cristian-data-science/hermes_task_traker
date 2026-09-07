/**
 * Adaptador del agente ZCode para el dispatcher: spawn headless, sesión en
 * db.sqlite, tailer de actividad (rollout JSONL) y swap global de modelo.
 *
 * Toda la lógica es la que vivía en dispatcher.mjs — extraída tal cual para
 * que el dispatcher sea agnóstico del motor (ver agents/claude.mjs).
 */
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  openSync,
  readSync,
  closeSync,
  readdirSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { ZCODE_CLI, AUTONOMY_MODE } from "../config.mjs";
import { readModelCatalog, swapModel } from "../models.mjs";

const ROLLOUT_DIR = path.join(os.homedir(), ".zcode", "cli", "rollout");
const TAIL_MS = 5000;

/**
 * ¿La sesión existe en la DB de ZCode? Las sesiones viven para siempre en
 * db.sqlite (la app desktop las tiene abiertas en modo compartido: abrir
 * read-only no molesta). Si la DB no se puede leer, true — el resume es
 * siempre mejor esfuerzo; el peor caso es un error rápido del CLI.
 */
function sessionAliveInDb(sessionId) {
  try {
    const db = new DatabaseSync(
      path.join(os.homedir(), ".zcode", "cli", "db", "db.sqlite"),
      { readOnly: true },
    );
    const row = db.prepare("SELECT 1 FROM session WHERE id = ?").get(sessionId);
    db.close();
    return !!row;
  } catch {
    return true;
  }
}

/**
 * Encuentra el rollout JSONL de la corrida: archivo nuevo (mtime posterior al
 * spawn) cuyo contenido mencione el taskId. OJO: el taskId vive en el prompt
 * del usuario, que va DESPUÉS del system prompt (~40KB+) — hay que mirar
 * hondo (1MB), con 8KB nunca matcheaba y el tailer quedaba mudo.
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
        const size = statSync(f).size;
        const fd = openSync(f, "r");
        const buf = Buffer.alloc(Math.min(size, 1_000_000));
        readSync(fd, buf, 0, buf.length, 0);
        closeSync(fd);
        if (buf.toString("utf8").includes(taskId)) return f;
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

export const zcodeAdapter = {
  id: "zcode",
  label: "ZCode",
  /** Ejecutable: el bundle .cjs se lanza con node. */
  exe: process.execPath,

  /** Spawn: node <zcode.cjs> -p <prompt> [--resume sess] --cwd ... --mode yolo --json */
  buildSpawn({ prompt, sessionId, folder, autonomy, model, env }) {
    const mode = AUTONOMY_MODE[autonomy] ?? "yolo";
    return {
      exe: process.execPath,
      args: [
        ZCODE_CLI,
        "-p",
        prompt,
        ...(sessionId ? ["--resume", sessionId] : []),
        "--cwd",
        folder,
        "--mode",
        mode,
        "--json",
      ],
      options: { env, windowsHide: true },
    };
  },

  /** --json: un solo objeto JSON al final; el sessionId viaja adentro. */
  extractSessionId(run, stdout) {
    const m = String(stdout).match(/"sessionId":\s*"(sess_[a-f0-9-]+)"/);
    return m ? m[1] : null;
  },

  extractResponse(stdout) {
    try {
      const j = JSON.parse(stdout);
      return typeof j.response === "string" ? j.response : null;
    } catch {
      return null;
    }
  },

  /** zcode --json no emite eventos en vivo: la actividad sale del tailer. */
  onStdoutLine() {},

  /** Observa el rollout de la corrida y reporta actividad nueva cada TAIL_MS. */
  startTailer(run, api) {
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
          api.activity(lastText);
        }
      } catch {
        // transcript puede rotar/desaparecer: el tailer es best-effort
      }
    }, TAIL_MS);
    return timer;
  },

  sessionAlive: sessionAliveInDb,

  /** Catálogo: models.mjs (desktop config + fallback estático). */
  modelCatalog: readModelCatalog,

  /** El swap global solo aplica a zcode (escribe ~/.zcode/cli/config.json). */
  needsSwap(effective, defaultModel) {
    return effective !== defaultModel;
  },
  swap: swapModel,

  effectiveModel(task, defaultModel) {
    return task.model || defaultModel || "";
  },
};
