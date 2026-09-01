#!/usr/bin/env node
/**
 * Wrapper del dispatcher con auto-restart: `npm run agent-bridge:daemon`.
 *
 * Mantiene el puente vivo: si el dispatcher muere (crash, deploy de Convex con
 * la conexión caída, etc.) lo relanza con backoff (2s→30s). Después de 5 min
 * de ejecución estable resetea el backoff. El lockfile del dispatcher garantiza
 * una sola instancia real.
 *
 * Para arranque automático al login de Windows (opcional):
 *   schtasks /create /tn "agent-bridge" /tr "cmd /c cd /d C:\Users\patag\git_provisorio\hermes_task_traker && npm run agent-bridge:daemon" /sc onlogon
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DISPATCHER = path.join(path.dirname(fileURLToPath(import.meta.url)), "dispatcher.mjs");

let backoffMs = 2000;
const BACKOFF_MAX = 30_000;
const STABLE_RESET = 5 * 60 * 1000;
let child = null;
let stopping = false;

function log(...a) {
  console.log(`[daemon ${new Date().toLocaleTimeString()}]`, ...a);
}

function start() {
  if (stopping) return;
  const startedAt = Date.now();
  log("levantando dispatcher…");
  child = spawn(process.execPath, [DISPATCHER], { stdio: "inherit", windowsHide: true });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    const uptime = Date.now() - startedAt;
    if (uptime > STABLE_RESET) backoffMs = 2000;
    log(`dispatcher salió (code=${code} signal=${signal}) — relanzo en ${backoffMs / 1000}s`);
    setTimeout(start, backoffMs);
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX);
  });
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopping = true;
    log("deteniendo daemon…");
    if (child) child.kill();
    process.exit(0);
  });
}

start();
