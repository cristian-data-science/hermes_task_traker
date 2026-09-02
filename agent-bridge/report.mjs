#!/usr/bin/env node
/**
 * CLI de reporte del agente: el canal de comunicación de toda corrida.
 *
 * Dos usos (protocolo del contrato, ver prompts.mjs):
 *
 *   1. PASO (después de cada paso, texto corto):
 *      node report.mjs --task <id> [--run <runId>] --step "backup creado"
 *      → se AGREGA a la checklist de la corrida en la app; no cambia el estado.
 *      Opcional: --progress <0-100>.
 *
 *   2. ESTADO (cambios de ciclo):
 *      node report.mjs --task <id> [--run <runId>] --state <estado>
 *          [--summary "máx 3 líneas"] [--question "..."]
 *      → mueve el ciclo (trabajando|pregunta|para-revision|hecho|error|cancelada);
 *        "pregunta" exige --question; "para-revision" apenas el objetivo esté
 *        verificado (la enumeración de pasos ya vive en la checklist).
 *
 * Si la corrida ya fue cerrada, los pasos son no-op y los estados exigen
 * --force (así el hook Stop watchdog no pisa informes reales).
 * Tras un estado terminal, dispara la notificación WhatsApp si la tarea lo pide.
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
  const { task, run, state, step, plan } = args;

  if (!task) {
    console.error(
      "uso: report.mjs --task <id> [--run <runId>] --step \"paso corto\" | " +
        "--plan \"1. paso | 2. paso | 3. paso\" | " +
        '--state <' + VALID_STATES.join("|") + '> [--summary "…" --question "…" --progress N] [--force --watchdog]',
    );
    process.exit(2);
  }
  if (!step && !plan && (!state || !VALID_STATES.includes(state))) {
    console.error(
      "necesitás --step <texto>, --plan <pasos separados por |> o --state <" +
        VALID_STATES.join("|") + ">",
    );
    process.exit(2);
  }
  if (state === "pregunta" && !args.question) {
    console.error("estado pregunta exige --question");
    process.exit(2);
  }

  const isStepOnly = !!step && !state;
  const isPlanOnly = !!plan && !state;
  const isFinalState = !isStepOnly && !isPlanOnly && state !== "trabajando";

  // Protección anti-pisado: pasos y planes siempre pasan; estados terminales
  // solo si la corrida está abierta (o --force).
  if (!isStepOnly && !isPlanOnly && !args.force) {
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
    state: isStepOnly || isPlanOnly ? "trabajando" : state,
    step,
    plan: plan
      ? String(plan)
          .split(/\s*[|\n]+\s*/)
          .map((s) => s.replace(/^\s*\d+[.)]\s*/, "").trim())
          .filter(Boolean)
      : undefined,
    summary: args.summary,
    question: args.question,
    progress: args.progress !== undefined ? Number(args.progress) : undefined,
    sessionId: args["session-id"],
    exitCode: args["exit-code"] !== undefined ? Number(args["exit-code"]) : undefined,
    error: args.error,
    watchdog: !!args.watchdog,
  });
  console.log(
    isPlanOnly ? `plan registrado (${String(plan).split(/[|\n]/).length} pasos)`
      : isStepOnly ? `paso: ${step}`
      : `reportado: ${state}`,
  );

  // Notificación WhatsApp: pasos solo en modo periodica; estados terminales
  // según el modo de la tarea (final → solo terminal).
  try {
    const info = await q("agent:taskForNotify", { taskId: task });
    if (info) {
      if (isStepOnly) {
        await notifyAgent(info.notifyWhatsapp, "paso", {
          title: info.title,
          state: "paso",
          summary: step,
          taskId: task,
        });
      } else if (isFinalState) {
        await notifyAgent(info.notifyWhatsapp, "final", {
          title: info.title,
          state,
          summary: args.summary,
          question: args.question,
          taskId: task,
        });
      }
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
