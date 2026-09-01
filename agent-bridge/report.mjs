#!/usr/bin/env node
/**
 * CLI de reporte del agente: el ÚLTIMO paso de toda corrida despachada.
 *
 *   node report.mjs --task <taskId> --run <runId> --state <estado>
 *                   --summary "..." [--question "..."] [--progress N]
 *                   [--session-id sess_...] [--force] [--watchdog]
 *
 * Estados: trabajando | pregunta | para-revision | hecho | error | cancelada
 *  - pregunta exige --question.
 *  - Si la corrida ya fue cerrada (el agente ya reportó), no-op salvo --force:
 *    así el hook Stop (watchdog) no pisa el informe real.
 * Tras reportar, dispara la notificación WhatsApp si la tarea lo pide.
 *
 * Auth: token del env ZCODE_SESSION_TOKEN (heredado del despacho) o cache.
 */
import { getToken, q, m } from "./auth.mjs";
import { notifyAgent } from "./notify.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

const VALID_STATES = [
  "trabajando",
  "pregunta",
  "para-revision",
  "hecho",
  "error",
  "cancelada",
];

async function main() {
  const args = parseArgs(process.argv);
  const { task, run, state } = args;

  if (!task || !state || !VALID_STATES.includes(state)) {
    console.error(
      "uso: report.mjs --task <id> [--run <runId>] --state <" +
        VALID_STATES.join("|") +
        '> --summary "..." [--question "..." --progress N --session-id ... --force --watchdog]',
    );
    process.exit(2);
  }
  if (state === "pregunta" && !args.question) {
    console.error("estado pregunta exige --question");
    process.exit(2);
  }

  // Watchdog/sobre-reporteo: si no hay corrida abierta, no pisar el informe.
  if (!args.force) {
    const runs = await q("agent:runsByTask", { taskId: task });
    const open = (runs || []).some(
      (r) =>
        r.state === "despachada" || r.state === "trabajando" || r.state === "pregunta",
    );
    if (!open) {
      console.log("nada que reportar (la corrida ya está cerrada)");
      return;
    }
  }

  await m("agent:agentReport", {
    taskId: task,
    runId: run && /^[a-z0-9]+$/i.test(run) ? run : undefined,
    state,
    summary: args.summary,
    question: args.question,
    progress: args.progress !== undefined ? Number(args.progress) : undefined,
    sessionId: args["session-id"],
    exitCode: args["exit-code"] !== undefined ? Number(args["exit-code"]) : undefined,
    error: args.error,
    watchdog: !!args.watchdog,
  });
  console.log(`reportado: ${state}`);

  // Notificación WhatsApp según el modo de la tarea.
  try {
    const info = await q("agent:taskForNotify", { taskId: task });
    if (info) {
      await notifyAgent(info.notifyWhatsapp, "final", {
        title: info.title,
        state,
        summary: args.summary,
        question: args.question,
        taskId: task,
      });
    }
  } catch (err) {
    // la notificación nunca rompe el reporte
    console.error("[notify] omitida:", String(err));
  }
}

main().catch((err) => {
  console.error("report.mjs falló:", err?.message ?? err);
  process.exit(1);
});
