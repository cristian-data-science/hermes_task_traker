/**
 * Cuentas de Claude Code (Enterprise / Personal) para el puente.
 *
 * Cada cuenta es una carpeta de config propia: el CLI la toma de la env
 * CLAUDE_CONFIG_DIR y ahí guarda su login (.credentials.json), sus sesiones
 * (projects/) y su settings.json. Así las DOS cuentas quedan logueadas a la
 * vez y elegir una no desloguea la otra (verificado en 2.1.263: carpeta
 * vacía → `claude auth status` = loggedIn:false, sin tocar ~/.claude).
 *
 * La cuenta cuya carpeta es ~/.claude corre SIN CLAUDE_CONFIG_DIR: idéntico
 * a como corría el puente antes de este módulo.
 *
 * Registro por defecto: enterprise = ~/.claude, personal = ~/.claude-personal.
 * Override: env CLAUDE_ACCOUNTS='[{"id":"x","label":"X","dir":"C:\\..."}]'.
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CLAUDE_CLI, CLAUDE_HOME } from "./config.mjs";

function loadAccounts() {
  if (process.env.CLAUDE_ACCOUNTS) {
    try {
      const list = JSON.parse(process.env.CLAUDE_ACCOUNTS);
      if (Array.isArray(list) && list.length) return list;
    } catch {
      console.warn("⚠ CLAUDE_ACCOUNTS no es JSON válido: se usa el registro por defecto");
    }
  }
  return [
    { id: "enterprise", label: "Enterprise", dir: CLAUDE_HOME },
    { id: "personal", label: "Personal", dir: path.join(os.homedir(), ".claude-personal") },
  ];
}

export const CLAUDE_ACCOUNTS = loadAccounts();
/** Cuenta de respaldo si la app no manda default (la primera del registro). */
export const FALLBACK_ACCOUNT_ID = CLAUDE_ACCOUNTS[0].id;

const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** Cuenta por id (null si el id no existe en el registro). */
export function accountById(id) {
  return CLAUDE_ACCOUNTS.find((a) => a.id === id) ?? null;
}

/**
 * Env del proceso hijo para una cuenta: CLAUDE_CONFIG_DIR solo si la carpeta
 * no es ~/.claude (y se QUITA si el puente la heredó, para que la cuenta
 * default no corra por accidente con otra).
 */
export function envForAccount(baseEnv, id) {
  const acct = accountById(id);
  const env = { ...baseEnv };
  delete env.CLAUDE_CONFIG_DIR;
  if (acct && !samePath(acct.dir, CLAUDE_HOME)) env.CLAUDE_CONFIG_DIR = acct.dir;
  return env;
}

/**
 * Crea la carpeta de la cuenta si falta. La primera vez copia settings.json
 * y CLAUDE.md desde ~/.claude (mismas reglas, mismos hooks del puente).
 * Nunca pisa lo que ya existe.
 */
export function ensureAccountDir(id) {
  const acct = accountById(id);
  if (!acct || samePath(acct.dir, CLAUDE_HOME)) return;
  mkdirSync(acct.dir, { recursive: true });
  for (const f of ["settings.json", "CLAUDE.md"]) {
    const src = path.join(CLAUDE_HOME, f);
    const dst = path.join(acct.dir, f);
    if (existsSync(src) && !existsSync(dst)) copyFileSync(src, dst);
  }
}

/** Corre el CLI con la cuenta dada y devuelve {code, stdout, stderr}. */
function runCli(id, args, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(CLAUDE_CLI, args, {
        env: envForAccount(process.env, id),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({ code: -1, stdout: "", stderr: String(e?.message ?? e) });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: -1, stdout, stderr: `timeout ${timeoutMs / 1000}s` });
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(e?.message ?? e) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Estado real de la sesión de una cuenta (`claude auth status --json`).
 * Nunca lanza: un fallo del CLI vuelve como loggedIn:false + error.
 */
export async function authStatus(id) {
  const acct = accountById(id);
  const base = { id, label: acct?.label ?? id, checkedAt: Date.now() };
  if (!acct) return { ...base, loggedIn: false, error: `cuenta desconocida: ${id}` };
  // Carpeta inexistente = nunca se logueó (sin spawn: el CLI la crearía).
  if (!existsSync(acct.dir)) return { ...base, loggedIn: false };
  const res = await runCli(id, ["auth", "status", "--json"], 15_000);
  try {
    const j = JSON.parse(res.stdout.slice(res.stdout.indexOf("{")));
    return {
      ...base,
      loggedIn: j.loggedIn === true,
      ...(j.email ? { email: String(j.email) } : {}),
      ...(j.orgName ? { orgName: String(j.orgName) } : {}),
      ...(j.subscriptionType ? { subscriptionType: String(j.subscriptionType) } : {}),
    };
  } catch {
    const why = (res.stderr || res.stdout || `exit ${res.code}`).trim().slice(0, 200);
    return { ...base, loggedIn: false, error: why };
  }
}

/** Estado de todas las cuentas del registro (en paralelo). */
export function allAuthStatus() {
  return Promise.all(CLAUDE_ACCOUNTS.map((a) => authStatus(a.id)));
}

/** "Personal · a@b.com · Org (pro)" — para logs y la actividad de la corrida. */
export function describeAccount(st) {
  const parts = [st.label];
  if (st.email) parts.push(st.email);
  if (st.orgName) parts.push(st.subscriptionType ? `${st.orgName} (${st.subscriptionType})` : st.orgName);
  else if (st.subscriptionType) parts.push(st.subscriptionType);
  return parts.join(" · ");
}

/**
 * Login rápido: abre una consola VISIBLE con `claude auth login` apuntando
 * a la carpeta de la cuenta (el navegador se abre solo). La otra cuenta no
 * se toca. El puente corre oculto, pero `start` crea una ventana nueva.
 */
export function openLogin(id) {
  const acct = accountById(id);
  if (!acct) throw new Error(`cuenta desconocida: ${id}`);
  ensureAccountDir(id);
  const child = spawn(
    "cmd.exe",
    ["/c", "start", `Login Claude ${acct.label}`, "cmd", "/k", CLAUDE_CLI, "auth", "login"],
    {
      env: envForAccount(process.env, id),
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    },
  );
  child.unref();
}

/** Carpetas projects/ de todas las cuentas (historial de sesiones). */
export function accountProjectsDirs() {
  return CLAUDE_ACCOUNTS.map((a) => ({ id: a.id, dir: path.join(a.dir, "projects") }));
}

/** Codifica un cwd como lo hace Claude: C:\a\b → C--a-b. */
export function encodeCwd(cwd) {
  return String(cwd).replace(/[:.]/g, "").replace(/[\\/]/g, "-");
}

/**
 * Ubicación del JSONL de una sesión en CUALQUIER cuenta:
 * { accountId, file } o null. Prueba primero la carpeta del cwd.
 */
export function locateSession(sessionId, cwdHint) {
  for (const { id, dir } of accountProjectsDirs()) {
    const names = cwdHint ? [encodeCwd(cwdHint)] : [];
    try {
      for (const d of readdirSync(dir)) if (!names.includes(d)) names.push(d);
    } catch {
      continue; // cuenta sin projects/ todavía
    }
    for (const d of names) {
      const file = path.join(dir, d, `${sessionId}.jsonl`);
      if (existsSync(file)) return { accountId: id, file };
    }
  }
  return null;
}

/**
 * Deja la sesión disponible para --resume en la cuenta destino: si el JSONL
 * vive en otra cuenta (Cris cambió la cuenta de la tarea entre corridas), se
 * COPIA a projects/<cwd-codificado>/ de la destino. Devuelve true si la
 * sesión queda disponible ahí.
 */
export function ensureSessionInAccount(sessionId, accountId, cwd) {
  const loc = locateSession(sessionId, cwd);
  if (!loc) return false;
  if (loc.accountId === accountId) return true;
  const acct = accountById(accountId);
  if (!acct) return false;
  const dstDir = path.join(acct.dir, "projects", encodeCwd(cwd));
  try {
    mkdirSync(dstDir, { recursive: true });
    copyFileSync(loc.file, path.join(dstDir, `${sessionId}.jsonl`));
    return true;
  } catch {
    return false;
  }
}

/** Versión del CLI ("2.1.263") o null. */
export async function cliVersion() {
  const res = await runCli(FALLBACK_ACCOUNT_ID, ["--version"], 15_000);
  return res.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
}
