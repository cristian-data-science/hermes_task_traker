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

/** Deployment Convex: el mismo que usa la app web (default: .env.local). */
export const CONVEX_URL =
  process.env.CONVEX_URL || repoEnv.VITE_CONVEX_URL || repoEnv.CONVEX_URL || "";

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

export function assertConfig() {
  const problems = [];
  if (!CONVEX_URL) problems.push("Falta CONVEX_URL (env o .env.local VITE_CONVEX_URL)");
  if (!existsSync(RSA_KEY_PATH)) problems.push(`No existe la clave RSA: ${RSA_KEY_PATH}`);
  if (!existsSync(ZCODE_CLI)) problems.push(`No existe el CLI de ZCode: ${ZCODE_CLI}`);
  if (!existsSync(ZCODE_CONFIG)) problems.push(`No existe el config de ZCode: ${ZCODE_CONFIG}`);
  return problems;
}
