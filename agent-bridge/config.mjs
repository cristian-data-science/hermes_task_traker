/**
 * Configuración del puente agent-bridge (rutas y constantes del PC de Cris).
 *
 * Todo se puede sobreescribir por variable de entorno; los defaults apuntan a
 * las rutas estándar de esta máquina. Ver agent-bridge/README.md.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

export const BRIDGE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_DIR = path.resolve(BRIDGE_DIR, "..");

/** Lee variables tipo .env (KEY=VALUE) de un archivo, sin dependencias. */
function parseEnvFile(file) {
  const vars = {};
  try {
    const text = readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) vars[m[1]] = m[2];
    }
  } catch {
    // sin archivo → vacío
  }
  return vars;
}

const repoEnv = parseEnvFile(path.join(REPO_DIR, ".env.local"));

/**
 * Deployment Convex del puente.
 *
 * Orden: variable de entorno CONVEX_URL → .env.local (CONVEX_URL) → PRODUCCIÓN
 * (el default operativo de Cris: el puente vive para la app de Vercel).
 * Para pruebas contra dev: CONVEX_URL=https://adept-lyrebird-492.convex.cloud
 */
const PROD_CONVEX_URL = "https://effervescent-crab-895.convex.cloud";
export const CONVEX_URL =
  process.env.CONVEX_URL ||
  repoEnv.CONVEX_URL ||
  PROD_CONVEX_URL;

/** Clave privada RSA del tracker (la misma que arrastrás para iniciar sesión). */
export const RSA_KEY_PATH =
  process.env.HERMES_RSA_KEY || path.join(REPO_DIR, "keys", "rsa_key.p8");

/** CLI de ZCode (bundle .cjs dentro de la app desktop). */
export const ZCODE_CLI =
  process.env.ZCODE_CLI ||
  path.join(
    os.homedir(),
    "AppData",
    "Local",
    "Programs",
    "ZCode",
    "resources",
    "glm",
    "zcode.cjs",
  );

/** Config de usuario del CLI (acá vive el modelo default y el swap por tarea). */
export const ZCODE_CONFIG = path.join(os.homedir(), ".zcode", "cli", "config.json");

/**
 * Config del DESKTOP (v2): su sección provider[<providerKey>].models es la
 * lista VIVA de modelos del plan (GLM-5.3, GLM-5.3-Flash, GLM-5-Turbo) — más
 * fresca que el catálogo estático de resources/model-providers (que puede
 * quedar añejo y sin los modelos nuevos).
 */
export const ZCODE_DESKTOP_CONFIG = path.join(os.homedir(), ".zcode", "v2", "config.json");

/** Catálogo de modelos por provider (resources/model-providers/*.json). */
export const ZCODE_MODEL_PROVIDERS_DIR = path.join(
  path.dirname(ZCODE_CLI),
  "..",
  "model-providers",
);

/** CLI de Claude Code (binario nativo del paquete npm global). */
function resolveClaudeCli() {
  if (process.env.CLAUDE_CLI) return process.env.CLAUDE_CLI;
  const cand = path.join(
    os.homedir(),
    "AppData",
    "Roaming",
    "npm",
    "node_modules",
    "@anthropic-ai",
    "claude-code",
    "bin",
    "claude.exe",
  );
  return existsSync(cand) ? cand : "claude";
}
export const CLAUDE_CLI = resolveClaudeCli();

/** Home de Claude Code (sesiones, settings, hooks). */
export const CLAUDE_HOME = path.join(os.homedir(), ".claude");
/** Proyectos = una carpeta por cwd con los <session-uuid>.jsonl de historial. */
export const CLAUDE_PROJECTS_DIR = path.join(CLAUDE_HOME, "projects");
/** Settings de usuario (acá se registran los hooks del puente). */
export const CLAUDE_SETTINGS = path.join(CLAUDE_HOME, "settings.json");

/** CLI de Hermes (gateway WhatsApp ya conectado). */
function resolveHermesCli() {
  if (process.env.HERMES_CLI) return process.env.HERMES_CLI;
  const base = path.join(
    os.homedir(),
    "AppData",
    "Local",
    "hermes",
    "hermes-agent",
    "venv",
    "Scripts",
  );
  for (const cand of ["hermes.exe", "hermes.cmd", "hermes"]) {
    const p = path.join(base, cand);
    if (existsSync(p)) return p;
  }
  return "hermes";
}
export const HERMES_CLI = resolveHermesCli();

/** Target de WhatsApp según `hermes send --list`. */
export const WHATSAPP_TARGET = process.env.HERMES_WHATSAPP_TARGET || "whatsapp:Criss";

/** Cache del token de sesión (30 días; gitignored). */
export const TOKEN_CACHE = path.join(BRIDGE_DIR, ".token-cache.json");

/** Backup del config de ZCode durante el swap de modelo (gitignored). */
export const MODEL_BACKUP = path.join(BRIDGE_DIR, ".model-backup.json");

/**
 * Autonomía → modo de zcode.
 *
 * Empírico en 0.16.5 (headless -p): los modos con permisos (plan/build/edit)
 * NO dejan ejecutar Bash — no hay nadie que apruebe — y el agente no podría
 * llamar a report.mjs ni trabajar. El único modo operativo es `yolo`
 * (bypass). Los límites reales son: el contrato del prompt (conductual,
 * reforzado por tipo y por autonomía en prompts.mjs) y el timeout de corrida.
 *
 * Claude Code: mismo problema sin TTY → las tres autonomías mapean a
 * --permission-mode bypassPermissions (ver agents/claude.mjs).
 *
 * OJO: --disallowed-tools con specs "Bash(...)" elimina la herramienta Bash
 * ENTERA en 0.16.5 (no solo el patrón), así que NO se usa hasta que el CLI
 * arregle el matcher. Las reglas de git push / cero-git-en-reportes viven en
 * el prompt del contrato.
 */
export const AUTONOMY_MODE = {
  escenario: "yolo",
  supervisado: "yolo",
  autonomo: "yolo",
};

/** Nudge de WhatsApp (modo periodica) si la corrida pasa esto sin novedades. */
export const NUDGE_MS = 10 * 60 * 1000;

/** Concurrencia: una tarea a la vez (el swap de modelo lo exige). */
export const MAX_CONCURRENT = 1;

/**
 * Corridas Claude en paralelo: el modelo va por flag (--model/--effort), no
 * hay swap global, así que el límite es solo cortesía con la cuenta
 * Enterprise (y con la máquina).
 */
export const MAX_PARALLEL_CLAUDE = Number(process.env.MAX_PARALLEL_CLAUDE || 1);

export function assertConfig() {
  const problems = [];
  if (!CONVEX_URL) problems.push("Falta CONVEX_URL (env o .env.local VITE_CONVEX_URL)");
  if (!existsSync(RSA_KEY_PATH)) problems.push(`No existe la clave RSA: ${RSA_KEY_PATH}`);
  if (!existsSync(ZCODE_CLI)) problems.push(`No existe el CLI de ZCode: ${ZCODE_CLI}`);
  if (!existsSync(ZCODE_CONFIG)) problems.push(`No existe el config de ZCode: ${ZCODE_CONFIG}`);
  return problems;
}

/**
 * ¿Hay un ejecutable `name` en el PATH? (fallback de `resolveClaudeCli`: si no
 * está el binario del npm global, el spawn confía en la búsqueda por PATH.)
 */
function existsInPath(name) {
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) if (existsSync(path.join(dir, name + ext))) return true;
  }
  return false;
}

/** Claude es opcional: avisa (no tumba el puente) si no está instalado. */
export function claudeWarnings() {
  const warns = [];
  // Ruta concreta (env o npm global): el aviso solo aplica si NO existe.
  // Nombre pelado ("claude"): se resuelve por PATH, así que se busca ahí.
  const found = CLAUDE_CLI === "claude" ? existsInPath("claude") : existsSync(CLAUDE_CLI);
  if (!found)
    warns.push(`CLI de Claude Code no encontrado (se usa "${CLAUDE_CLI}"): instalalo con npm i -g @anthropic-ai/claude-code o seteá CLAUDE_CLI`);
  return warns;
}
