/**
 * Bitácora de actividad: escritura y lectura de la tabla `events`.
 *
 * Todo lo que pasa en el tablero deja rastro acá, y el Catch-up se arma
 * leyendo este log por rango de fechas. Ver el comentario de la tabla en
 * `schema.ts` para el porqué de un log separado en vez de derivar todo de los
 * timestamps de `tasks`.
 *
 * ===== REGLA DE ORO =====
 * Registrar un evento NUNCA debe romper la operación que lo originó. Si algo
 * falla al loguear, se traga el error: perder una línea de bitácora es
 * molesto; perder el cambio de estado de una tarea es inaceptable.
 */

import { query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAuth } from "./authGuard";

/** Tipos de evento que registramos. Espejo del union del schema. */
export type EventKind =
  | "created"
  | "status"
  | "completed"
  | "reopened"
  | "progress"
  | "subtask_done"
  | "subtask_undone"
  | "deleted"
  | "flagged"
  // Capa agente (CONTRATO_AGENTE.md §1)
  | "agent_dispatched"
  | "agent_update"
  | "agent_question"
  | "agent_answer"
  | "agent_review";

interface LogEventInput {
  taskId: Id<"tasks">;
  kind: EventKind;
  /** Tarea al momento del evento; de acá salen los snapshots de título/área. */
  task: Pick<Doc<"tasks">, "title" | "area">;
  at?: number;
  fromStatus?: string;
  toStatus?: string;
  fromProgress?: number;
  toProgress?: number;
  detail?: string;
  viaClickup?: boolean;
}

/** Largo máximo del texto libre de un evento (anti-abuso de almacenamiento). */
const DETAIL_MAX = 300;

/**
 * Inserta un evento en la bitácora.
 *
 * No es una mutation de Convex: es un helper que se llama DENTRO de las
 * mutations existentes, para que el evento y el cambio de datos ocurran en la
 * misma transacción y no puedan quedar desincronizados.
 */
export async function logEvent(
  ctx: MutationCtx,
  input: LogEventInput,
): Promise<void> {
  try {
    await ctx.db.insert("events", {
      taskId: input.taskId,
      kind: input.kind,
      at: input.at ?? Date.now(),
      area: input.task.area,
      title: input.task.title.slice(0, 200),
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      fromProgress: input.fromProgress,
      toProgress: input.toProgress,
      detail: input.detail?.slice(0, DETAIL_MAX),
      viaClickup: input.viaClickup,
    });
  } catch {
    // Ver "REGLA DE ORO" arriba: la bitácora es secundaria al dato.
  }
}

/**
 * Registra un cambio de estado, eligiendo el `kind` más expresivo.
 *
 * Un movimiento a "completado" no es un cambio de estado cualquiera: es EL
 * evento del catch-up. Lo mismo al revés (reabrir algo que estaba cerrado es
 * información que tu jefatura va a querer). Por eso se separan en vez de
 * quedar todos como `status` genérico.
 */
export async function logStatusChange(
  ctx: MutationCtx,
  args: {
    taskId: Id<"tasks">;
    task: Pick<Doc<"tasks">, "title" | "area">;
    from: string;
    to: string;
    at?: number;
    viaClickup?: boolean;
  },
): Promise<void> {
  if (args.from === args.to) return;
  const kind: EventKind =
    args.to === "completado"
      ? "completed"
      : args.from === "completado"
        ? "reopened"
        : "status";
  await logEvent(ctx, {
    taskId: args.taskId,
    kind,
    task: args.task,
    at: args.at,
    fromStatus: args.from,
    toStatus: args.to,
    viaClickup: args.viaClickup,
  });
}

/**
 * Lee la bitácora cruda de una tarea (más reciente primero).
 * Alimenta el historial que se muestra al abrir una tarea.
 */
export const listByTask = query({
  args: { sessionToken: v.string(), taskId: v.id("tasks") },
  handler: async (ctx, { sessionToken, taskId }) => {
    await requireAuth(ctx, sessionToken);
    const rows = await ctx.db
      .query("events")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();
    return rows.sort((a, b) => b.at - a.at);
  },
});
