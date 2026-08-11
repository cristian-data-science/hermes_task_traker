/**
 * Genera el texto plano del catch-up para pegar en un chat o un correo.
 *
 * ===== POR QUÉ NO ES UN VOLCADO DE LA PANTALLA =====
 * La vista está pensada para leerse mientras conversás; el texto está pensado
 * para que alguien que NO estuvo en la reunión entienda la semana. Por eso
 * omite lo decorativo (colores, contadores redundantes) y prioriza el orden en
 * que una jefatura pregunta: qué prometiste, qué hiciste, qué está abierto,
 * qué está trabado, qué te cayó encima.
 */

import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { FunctionReturnType } from "convex/server";
import type { api } from "~/convex/_generated/api";

export type WeekData = FunctionReturnType<typeof api.catchups.getWeek>;

/**
 * La parte del resumen que describe UNA semana concreta.
 *
 * Se separa del resto (`previous`, `closed`, `anchorDay`, que son contexto del
 * ciclo) porque es exactamente lo que se congela al cerrar. Así el mismo
 * componente y el mismo generador de texto sirven para la semana en vivo y
 * para un snapshot guardado hace tres meses, sin ramas duplicadas.
 */
export type WeekBody = Pick<
  WeekData,
  | "metrics"
  | "done"
  | "inProgress"
  | "queued"
  | "blocked"
  | "incoming"
  | "moves"
  | "talkingPoints"
>;

/**
 * Lee `queued` de un cuerpo que puede venir de un snapshot viejo.
 *
 * Los catch-ups cerrados antes de separar "En cola" de "En curso" no tienen
 * ese campo: TypeScript cree que sí porque el tipo es el actual, pero el JSON
 * guardado no lo trae. Sin este acceso defensivo, abrir un catch-up de esa
 * época rompería la vista entera.
 */
export function queuedOf(body: WeekBody): WeekBody["queued"] {
  return body.queued ?? [];
}

/** Etiqueta legible de un estado, sin depender del icono. */
const STATUS_LABEL: Record<string, string> = {
  urgente: "Urgente",
  pendiente: "Pendiente",
  "en-curso": "En curso",
  standby: "Standby",
  programado: "Programado",
  completado: "Completado",
};

const OUTCOME_MARK: Record<string, string> = {
  done: "[OK]",
  progress: "[~]",
  stalled: "[!]",
  gone: "[-]",
};

/** Ubicación corta de una tarea: "Ley de Datos › desarrollo". */
function place(item: { project: string | null; ancestors: string[] }): string {
  const parts = [item.project, ...item.ancestors].filter(Boolean) as string[];
  if (parts.length === 0) return "";
  if (parts.length <= 2) return parts.join(" › ");
  return `${parts[0]} › … › ${parts[parts.length - 1]}`;
}

const day = (ms: number) => format(new Date(ms), "EEEE d", { locale: es });

/** Días completos entre dos instantes. */
function daysAgo(since: number | null, now: number): number | null {
  if (since === null) return null;
  return Math.max(0, Math.floor((now - since) / 86400000));
}

/**
 * Arma el resumen completo en markdown ligero (compatible con Teams, Slack y
 * correo en texto plano).
 */
export function buildCatchupText(
  full: WeekData,
  opts: {
    windowLabel: string;
    /**
     * Cuerpo a volcar. Permite exportar el snapshot congelado de una semana
     * cerrada en vez del recálculo en vivo. Si se omite, se usa el de `full`.
     */
    body?: WeekBody;
    notes?: string;
  },
): string {
  const now = Date.now();
  const L: string[] = [];
  // `data` es el cuerpo (puede ser congelado); `full` conserva el contexto del
  // ciclo (compromisos previos, notas del cierre), que no vive en el snapshot.
  const data = { ...full, ...(opts.body ?? {}) };

  L.push(`CATCH-UP · ${opts.windowLabel}`);
  L.push("");

  // ---- Compromisos de la semana anterior ---------------------------------
  if (data.previous && data.previous.commitments.length > 0) {
    L.push("## Compromisos de la semana pasada");
    for (const c of data.previous.commitments) {
      const carry = c.carryCount > 0 ? ` (arrastrado ×${c.carryCount})` : "";
      L.push(`${OUTCOME_MARK[c.outcome] ?? "[?]"} ${c.text}${carry} — ${c.reason}`);
    }
    L.push("");
  }

  // ---- Titular -----------------------------------------------------------
  const m = data.metrics;
  const delta = m.completed - m.completedPrevWeek;
  const deltaTxt =
    delta === 0 ? "igual que la semana pasada" : `${delta > 0 ? "+" : ""}${delta} vs. semana pasada`;
  L.push("## Resumen");
  L.push(`Completadas: ${m.completed} (${deltaTxt})`);
  L.push(
    `Abiertas ahora: ${m.inProgress} en curso · ${m.queued ?? 0} en cola · ${m.blocked} detenidas · Entraron: ${m.created}`,
  );
  L.push("");

  // ---- Hecho -------------------------------------------------------------
  if (data.done.length > 0) {
    L.push("## Completado esta semana");
    let lastDay = "";
    for (const d of data.done) {
      const dLabel = day(d.at);
      if (dLabel !== lastDay) {
        L.push(`**${dLabel}**`);
        lastDay = dLabel;
      }
      const where = place(d);
      L.push(`- ${d.title}${where ? ` — ${where}` : ""}`);
      for (const s of d.subtasks) L.push(`    · ${s.title}`);
    }
    L.push("");
  } else {
    L.push("## Completado esta semana");
    L.push("- Nada cerrado en esta ventana.");
    L.push("");
  }

  // ---- Avances sin cierre ------------------------------------------------
  // Una tarea grande puede no cerrarse en la semana y aun así haber avanzado.
  // Sin este bloque, esas semanas se ven vacías aunque no lo estén.
  const advanced = [...data.inProgress, ...queuedOf(data)].filter(
    (t) => t.advancedSubtasks.length > 0,
  );
  if (advanced.length > 0) {
    L.push("## Avances en tareas todavía abiertas");
    for (const t of advanced) {
      L.push(`- ${t.title}${t.progress !== null ? ` (${t.progress}%)` : ""}`);
      for (const s of t.advancedSubtasks) L.push(`    · ${s.title}`);
    }
    L.push("");
  }

  // ---- En curso ----------------------------------------------------------
  if (data.inProgress.length > 0) {
    L.push("## En curso ahora");
    for (const t of data.inProgress) {
      const d = daysAgo(t.since, now);
      // El "~" marca que el dato es la edad de la tarea y no el tiempo real en
      // el estado (tareas anteriores a la bitácora). Si se omitiera, el texto
      // afirmaría algo que la app no sabe.
      const approx = t.sinceKind === "created" ? "~" : "";
      const age = d === null ? "" : d === 0 ? " · hoy" : ` · hace ${approx}${d} d`;
      const where = place(t);
      L.push(
        `- ${t.title}${t.progress !== null ? ` (${t.progress}%)` : ""}${where ? ` — ${where}` : ""}${age}`,
      );
    }
    L.push("");
  }

  // ---- En cola -----------------------------------------------------------
  const queued = queuedOf(data);
  if (queued.length > 0) {
    L.push("## En cola");
    for (const t of queued) {
      const d = daysAgo(t.since, now);
      const approx = t.sinceKind === "created" ? "~" : "";
      const age = d === null || d === 0 ? "" : ` · esperando hace ${approx}${d} d`;
      // El bloque mezcla urgentes y pendientes: sin el estado, en texto plano
      // no habría forma de distinguirlas (en pantalla lo hace el chip).
      const st = STATUS_LABEL[t.status] ?? t.status;
      L.push(`- [${st}] ${t.title}${age}`);
    }
    L.push("");
  }

  // ---- Detenido ----------------------------------------------------------
  if (data.blocked.length > 0) {
    L.push("## Detenido / esperando");
    for (const t of data.blocked) {
      const d = daysAgo(t.since, now);
      const approx = t.sinceKind === "created" ? "~" : "";
      const age =
        d === null ? "" : ` · ${approx}${d} d en ${STATUS_LABEL[t.status] ?? t.status}`;
      L.push(`- ${t.title}${age}`);
    }
    L.push("");
  }

  // ---- Reabierto ---------------------------------------------------------
  // Va antes de "entró esta semana" a propósito: es la mala noticia, y en un
  // catch-up las malas noticias se dan temprano, no escondidas al final.
  const reopened = new Map<string, (typeof data.moves)[number]>();
  for (const m of data.moves) if (m.reopened) reopened.set(m.taskId, m);
  if (reopened.size > 0) {
    L.push("## Reabierto esta semana");
    for (const m of reopened.values()) {
      L.push(`- ${m.title} — volvió a ${STATUS_LABEL[m.to ?? ""] ?? m.to ?? "abierta"}`);
    }
    L.push("");
  }

  // ---- Entró esta semana -------------------------------------------------
  if (data.incoming.length > 0) {
    L.push("## Entró esta semana");
    for (const t of data.incoming) {
      const src = t.fromClickup ? "ClickUp" : "propia";
      const closed = t.closedSameWeek ? " · ya cerrada" : "";
      const who = t.requestedBy ? ` · pide: ${t.requestedBy}` : "";
      L.push(`- ${t.title} (${src})${who}${closed}`);
    }
    L.push("");
  }

  // ---- Temas para conversar ----------------------------------------------
  if (data.talkingPoints.length > 0) {
    L.push("## Temas para conversar");
    for (const t of data.talkingPoints) {
      L.push(`- ${t.title}${t.note ? `: ${t.note}` : ""}`);
    }
    L.push("");
  }

  // ---- Notas -------------------------------------------------------------
  const notes = opts.notes ?? data.closed?.notes;
  if (notes && notes.trim()) {
    L.push("## Notas");
    L.push(notes.trim());
    L.push("");
  }

  return L.join("\n").trimEnd() + "\n";
}
