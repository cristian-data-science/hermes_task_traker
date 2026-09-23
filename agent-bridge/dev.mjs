#!/usr/bin/env node
/**
 * Puente contra el deployment de DESARROLLO: `npm run agent-bridge:dev`.
 *
 * Sin esto, las tareas creadas en la app de dev quedaban "encoladas" para
 * siempre: el único puente vivo (tarea programada "Agent Bridge") apunta a
 * producción. Este lanzador fija CONVEX_URL al deployment de dev (el de
 * `.env.local`, VITE_CONVEX_URL) y levanta el daemon con auto-restart. Usa
 * candado y caché de sesión propios (sufijo por deployment en config.mjs), así
 * que convive con el puente de producción.
 *
 * Ojo: ambos puentes comparten la config global de ZCode. Una tarea ZCode con
 * modelo distinto al default hace swap de esa config; evita correr a la vez
 * tareas ZCode con modelo no-default en dev y en producción.
 *
 * Clave RSA: si este checkout no tiene keys/rsa_key.p8 (p. ej. un worktree),
 * usa la del checkout principal o HERMES_RSA_KEY.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

function envFileVar(file, key) {
  try {
    const m = readFileSync(file, "utf8").match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, "m"));
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

const DEV_URL =
  process.env.CONVEX_DEV_URL ||
  envFileVar(path.join(REPO, ".env.local"), "VITE_CONVEX_URL") ||
  "https://adept-lyrebird-492.convex.cloud";

const env = { ...process.env, CONVEX_URL: DEV_URL };
if (!env.HERMES_RSA_KEY && !existsSync(path.join(REPO, "keys", "rsa_key.p8"))) {
  const main = path.join(path.dirname(REPO), "hermes_task_traker", "keys", "rsa_key.p8");
  if (existsSync(main)) env.HERMES_RSA_KEY = main;
}

console.log(`[dev] puente contra ${DEV_URL}`);
const child = spawn(process.execPath, [path.join(HERE, "daemon.mjs")], {
  stdio: "inherit",
  env,
  windowsHide: true,
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
