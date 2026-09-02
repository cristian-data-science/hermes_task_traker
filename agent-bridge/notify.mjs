/**
 * Notificaciones WhatsApp vía Hermes (gateway ya conectado; sin LLM).
 *
 * FORMATO NUEVO (ordenado, minimalista — 1 línea por mensaje):
 *   - plan:      el PRIMER mensaje: "📋 Plan (5 pasos)" numerado.
 *   - paso:      "▸ 3/7 · <paso>" — un renglón, SIN bloque de metadata.
 *   - final:     resultado compacto (✅ para-revisión / ❓ pregunta / ⚠ error).
 * Sin mensajes de "inicio" ni "nudge" (puro ruido — eliminados).
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

/** Título corto de la tarea para el asunto (el chat ya lo muestra completo). */
function shortTitle(title) {
  return (title ?? "tarea").slice(0, 40);
}

/**
 * Notifica un evento del agente. `mode` es el notifyWhatsapp de la tarea:
 *  - off: nunca
 *  - final: solo estados terminales (pregunta/para-revisión/hecho/error)
 *  - periodica: plan + cada paso (1 línea) + final
 */
export async function notifyAgent(mode, kind, payload) {
  if (!mode || mode === "off") return { ok: true, skipped: true };
  const isFinal = kind === "final";
  const isPlan = kind === "plan";
  const isStep = kind === "paso";
  if (mode === "final" && !isFinal) return { ok: true, skipped: true };

  const st = shortTitle(payload.title);
  let subject, body;

  if (isPlan) {
    const steps = payload.plan ?? [];
    subject = `[Agente] 📋 Plan (${steps.length}) · ${st}`;
    body = steps.map((p, i) => `${i + 1}. ${p}`).join("\n");
  } else if (isStep) {
    const n = payload.stepIndex ? `${payload.stepIndex}/${payload.planTotal ?? "?"}` : "";
    subject = `[Agente] ${n ? n + " · " : ""}${st}`;
    body = `▸ ${payload.step ?? payload.summary ?? ""}`;
  } else {
    // final
    const icon =
      payload.state === "hecho" ? "✅" :
      payload.state === "para-revision" ? "🟡" :
      payload.state === "pregunta" ? "❓" : "⚠";
    subject = `[Agente] ${icon} ${payload.state} · ${st}`;
    body = payload.question
      ? `❓ ${payload.question}`
      : (payload.summary ?? "").split("\n").slice(0, 3).join("\n");
  }

  const res = await send(WHATSAPP_TARGET, subject, body);
  if (!res.ok) console.error(`[notify] fallo WhatsApp:`, res.out || res.error);
  return res;
}
