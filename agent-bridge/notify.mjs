/**
 * Notificaciones WhatsApp vía Hermes (gateway ya conectado; sin LLM).
 *
 * `hermes send --to whatsapp:Criss --subject "..." "mensaje"` — verificado:
 * reusa las credenciales del gateway, no requiere gateway corriendo.
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

/**
 * Notifica un evento del agente. `mode` es el notifyWhatsapp de la tarea:
 *  - off: nunca
 *  - final: solo estados terminales (pregunta/para-revisión/hecho/error)
 *  - periodica: todo (inicio, progreso, nudge, final)
 */
export async function notifyAgent(mode, kind, payload) {
  if (!mode || mode === "off") return { ok: true, skipped: true };
  const isFinal = kind === "final";
  if (mode === "final" && !isFinal) return { ok: true, skipped: true };

  const state = payload.state ?? kind;
  const title = payload.title ? payload.title.slice(0, 60) : "tarea";
  const subject = `[agente] ${state} · ${title}`;
  const lines = [
    `Tarea: ${payload.title ?? "-"}`,
    payload.folder ? `Carpeta: ${payload.folder}` : null,
    payload.model ? `Modelo: ${payload.model}` : null,
    `Estado: ${state}`,
    payload.summary ? `\n${String(payload.summary).slice(0, 700)}` : null,
    payload.question ? `\nPregunta: ${payload.question}` : null,
    payload.taskId ? `\n(taskId: ${payload.taskId})` : null,
  ].filter(Boolean);
  const res = await send(WHATSAPP_TARGET, subject, lines.join("\n"));
  if (!res.ok) console.error(`[notify] fallo WhatsApp:`, res.out || res.error);
  return res;
}
