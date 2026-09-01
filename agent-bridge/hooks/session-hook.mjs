#!/usr/bin/env node
/**
 * Hook SessionStart de ZCode (re-inyección de contexto de la tarea).
 *
 * No-op salvo en corridas despachadas por el puente (ZCODE_TASK_ID en env).
 * Si Cris abre después la sesión en el desktop (comparten db.sqlite), este
 * hook vuelve a inyectar el contexto de la tarea como additionalContext.
 *
 * Salida: JSON {"additionalContext": "..."} en stdout (protocolo de hooks).
 */
import { CONVEX_URL } from "../config.mjs";

async function main() {
  const taskId = process.env.ZCODE_TASK_ID;
  const token = process.env.ZCODE_SESSION_TOKEN;
  if (!taskId || !token) return;

  const res = await fetch(`${CONVEX_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "agent/taskForNotify",
      args: { sessionToken: token, taskId },
    }),
  });
  if (!res.ok) return;
  const data = await res.json();
  const info = data?.value;
  if (!info) return;

  process.stdout.write(
    JSON.stringify({
      additionalContext:
        `[puente hermes] Esta sesión corresponde a la tarea delegada ` +
        `"${info.title}" (estado: ${info.agentState ?? "?"}). ` +
        `Al terminar reporta con agent-bridge/report.mjs y no pierdas el contexto del contrato.`,
    }),
  );
}

main().catch(() => {});
