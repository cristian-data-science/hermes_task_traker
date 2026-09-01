#!/usr/bin/env node
/**
 * Hook Stop de ZCode (watchdog del puente).
 *
 * Se registra GLOBALMENTE en ~/.zcode/cli/config.json pero es no-op salvo en
 * corridas despachadas por el puente (detecta ZCODE_TASK_ID en el env, que el
 * despachador inyecta al spawn). Si el agente terminó SIN llamar a report.mjs,
 * reporta él con lo que tiene y evita que la tarea quede "trabajando" para
 * siempre. report.mjs ignora corridas ya cerradas → no pisa informes reales.
 *
 * Entrada (stdin): JSON del evento con session_id (formato hooks de ZCode).
 * Salida: nada (los hooks Stop no inyectan contexto).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BRIDGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPORT = path.join(BRIDGE_DIR, "report.mjs");

async function main() {
  const taskId = process.env.ZCODE_TASK_ID;
  const runId = process.env.ZCODE_RUN_ID;
  if (!taskId || !runId) return; // sesión normal del usuario: no-op

  // stdin: payload del hook (leemos por si trae session_id del transcript).
  let sessionId = process.env.ZCODE_SESSION_ID_FOR_HOOK || "";
  try {
    const raw = await new Promise((resolve) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (c) => (data += c));
      process.stdin.on("end", () => resolve(data));
      setTimeout(() => resolve(data), 1500);
    });
    const payload = JSON.parse(raw);
    sessionId = payload.session_id || payload.sessionId || sessionId;
  } catch {
    // sin stdin útil → seguimos sin session id
  }

  // Margen para que el propio agente reporte primero (lo llama en su turno).
  await new Promise((r) => setTimeout(r, 4000));

  const args = [
    REPORT,
    "--task",
    taskId,
    "--run",
    runId,
    "--state",
    "para-revision",
    "--summary",
    "(watchdog) La sesión terminó sin reporte explícito del agente. Revisá la corrida en la app o re-despachá si quedó incompleto.",
    "--watchdog",
  ];
  if (sessionId) args.push("--session-id", sessionId);

  await new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => resolve());
    child.on("close", () => resolve());
  });
}

main().catch(() => {});
