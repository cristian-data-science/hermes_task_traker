/**
 * Notificaciones WhatsApp vía Hermes (gateway ya conectado; sin LLM).
 *
 * FORMATO (ordenado, mínimo, SIN spam):
 *   - plan inicial: "📋 Plan (5)" numerado — SOLO la primera vez.
 *   - re-plan:      "🔄 Plan actualizado (N) · nuevo rumbo: <items nuevos>"
 *                   en UNA línea (el agente re-envía --plan seguido; volcar el
 *                   plan completo cada vez era puro spam de WhatsApp).
 *   - paso:         "▸ 3/7 · <paso>" — un renglón, sin metadata.
 *   - reanudada:    "♻ Reanudada" — explica por qué la numeración vuelve a
 *                   empezar (corrida interrumpida y retomada).
 *   - final:        estado en español + resumen (3 líneas) + duración/pasos.
 * Todos los encabezados dicen QUÉ agente trabaja ([Claude]/[ZCode]).
 *
 * `hermes send --to whatsapp:Criss` — reusa las credenciales del gateway.
 */
import { spawn } from "node:child_process";
import { HERMES_CLI, WHATSAPP_TARGET } from "./config.mjs";

function send(target, subject, message) {
  return new Promise((resolve) => {
    const args = ["send", "--to", target, "--subject", subject, message];
    const child = spawn(HERMES_CLI, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (err) => resolve({ ok: false, error: String(err) }));
    child.on("close", (code) =>
      resolve({ ok: code === 0, code, out: out.slice(0, 500) }),
    );
  });
}

/** Etiqueta corta del agente para el encabezado (Claude/ZCode/Agente). */
function agentTag(executor) {
  if (executor === "claude") return "Claude";
  if (executor === "zcode") return "ZCode";
  return "Agente";
}

/** Título corto de la tarea para el asunto (el chat ya lo muestra completo). */
function shortTitle(title) {
  return (title ?? "tarea").slice(0, 40);
}

/** Normaliza un ítem de plan para comparar (diff de re-plan). */
const normStep = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñ ]/gi, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Formatea un evento → {subject, body}. Puro (sin IO): testeable y lo usa
 * notifyAgent para enviar.
 */
export function formatNotification(kind, payload) {
  const tag = agentTag(payload.executor);
  const st = shortTitle(payload.title);

  if (kind === "plan") {
    const steps = payload.plan ?? [];
    return {
      subject: `[${tag}] 📋 Plan (${steps.length}) · ${st}`,
      body: steps.map((p, i) => `${i + 1}. ${p}`).join("\n"),
    };
  }

  if (kind === "planListo") {
    const steps = payload.plan ?? [];
    const body =
      (steps.length ? steps.map((p, i) => `${i + 1}. ${p}`).join("\n") + "\n\n" : "") +
      "👉 Revísalo en la app: apruébalo o pídele cambios antes de que ejecute.";
    return {
      subject: `[${tag}] 📋 Plan por tu OK (${steps.length}) · ${st}`,
      body,
    };
  }

  if (kind === "replan") {
    const steps = payload.plan ?? [];
    const prev = new Set((payload.previousPlan ?? []).map(normStep));
    const nuevos = steps.filter((p) => !prev.has(normStep(p)));
    const extra = nuevos.length
      ? `➕ nuevo rumbo: ${nuevos.join(" · ").slice(0, 220)}`
      : `ajustó el orden/detalle de sus pasos`;
    return {
      subject: `[${tag}] 🔄 Plan actualizado (${steps.length}) · ${st}`,
      body: extra,
    };
  }

  if (kind === "paso") {
    const n = payload.stepIndex ? `${payload.stepIndex}/${payload.planTotal ?? "?"}` : "";
    return {
      subject: `[${tag}] ${n ? `${n} · ` : ""}${st}`,
      body: `▸ ${payload.step ?? payload.summary ?? ""}`,
    };
  }

  if (kind === "reanudada") {
    return {
      subject: `[${tag}] ♻ Reanudada · ${st}`,
      body: `La corrida se retomó tras una interrupción (misma sesión, contexto intacto). La numeración de pasos vuelve a empezar.`,
    };
  }

  // final
  const STATES = {
    hecho: "✅ Hecho",
    "para-revision": "🟡 Para revisión",
    pregunta: "❓ Pregunta",
    error: "⚠ Error",
    cancelada: "🚫 Cancelada",
  };
  const label = STATES[payload.state] ?? `🔔 ${payload.state ?? "fin"}`;
  const bits = [];
  if (payload.runStartedAt) {
    const min = Math.max(1, Math.round((Date.now() - payload.runStartedAt) / 60000));
    bits.push(`⏱ ${min} min`);
  }
  if (payload.stepIndex) bits.push(`${payload.stepIndex} pasos`);
  if (payload.runsCount > 1) bits.push(`${payload.runsCount} corridas`);
  const body =
    payload.state === "pregunta"
      ? `${payload.question ?? ""}\n\n👉 Responde en la app para que continúe.`
      : payload.state === "error"
        ? `${(payload.error || payload.summary || "").split("\n")[0].slice(0, 300)}\n\n👉 Revisa la corrida en la app y responde para reintentar.`
        : (payload.summary ?? "").split("\n").slice(0, 3).join("\n");
  return {
    subject: `[${tag}] ${label} · ${st}`,
    body: [body, bits.join(" · ")].filter(Boolean).join("\n"),
  };
}

/**
 * Notifica un evento del agente. `mode` es el notifyWhatsapp de la tarea:
 *  - off: nunca
 *  - final: solo lo que exige a Cris actuar (plan por aprobar, estados finales)
 *  - periodica: plan inicial + re-plan compacto + cada paso + reanudada + final
 */
export async function notifyAgent(mode, kind, payload) {
  if (!mode || mode === "off") return { ok: true, skipped: true };
  // El plan esperando OK pausa la tarea hasta que Cris actúe: se avisa igual
  // que los estados finales, también en modo "final".
  const isActionable = kind === "final" || kind === "planListo";
  if (mode === "final" && !isActionable) return { ok: true, skipped: true };

  const { subject, body } = formatNotification(kind, payload);
  const res = await send(WHATSAPP_TARGET, subject, body);
  if (!res.ok) console.error(`[notify] fallo WhatsApp:`, res.out || res.error);
  return res;
}
