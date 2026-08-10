import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireAuth } from "./authGuard";
import { logEvent } from "./events";

/** Argumento de sesión obligatorio en toda función pública. */
const sessionArg = { sessionToken: v.string() };

/** Límite de longitud para el título de una sub-tarea. */
const SUBTITLE_MAX = 200;

/**
 * Sincroniza el progreso de la tarea padre con sus sub-tareas.
 *
 * Reglas:
 *  - Todas las sub-tareas completadas → progreso 100%.
 *  - Si venía en 100% y se desmarca alguna → recalcula al % real
 *    (así el slider no se queda "mintiendo" en 100).
 *  - En cualquier otro caso se respeta el valor manual del slider.
 *
 * Solo considera sub-tareas activas (no borradas).
 */
async function syncProgressFromSubtasks(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
) {
  const subs = await ctx.db
    .query("subtasks")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();
  const active = subs.filter((s) => s.deletedAt === undefined);
  if (active.length === 0) return;

  const done = active.filter((s) => s.done).length;
  const pct = Math.round((done / active.length) * 100);

  const task = await ctx.db.get(taskId);
  if (!task || task.deletedAt !== undefined) return;

  const allDone = done === active.length;
  const wasFull = (task.progress ?? 0) === 100;
  if (!allDone && !wasFull) return; // respetar el valor manual

  if (task.progress !== pct) {
    await ctx.db.patch(taskId, { progress: pct, updatedAt: Date.now() });
  }
}

/**
 * Devuelve los conteos de sub-tareas {done, total} agrupados por taskId.
 * Una sola query para alimentar a todos los TaskCards.
 * Solo cuenta sub-tareas activas (no borradas).
 */
export const allCounts = query({
  args: sessionArg,
  handler: async (ctx, { sessionToken }) => {
    await requireAuth(ctx, sessionToken);
    const all = await ctx.db.query("subtasks").collect();
    const map: Record<string, { done: number; total: number }> = {};
    for (const s of all) {
      if (s.deletedAt !== undefined) continue;
      const key = s.taskId;
      if (!map[key]) map[key] = { done: 0, total: 0 };
      map[key].total += 1;
      if (s.done) map[key].done += 1;
    }
    return map;
  },
});

/** Lista las sub-tareas activas de una tarea, ordenadas. */
export const listByTask = query({
  args: { ...sessionArg, taskId: v.id("tasks") },
  handler: async (ctx, { sessionToken, taskId }): Promise<Doc<"subtasks">[]> => {
    await requireAuth(ctx, sessionToken);
    const all = await ctx.db
      .query("subtasks")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .order("asc")
      .collect();
    return all.filter((s) => s.deletedAt === undefined);
  },
});

/** Crea una sub-tarea al final de la lista de la tarea padre. */
export const create = mutation({
  args: { ...sessionArg, taskId: v.id("tasks"), title: v.string() },
  handler: async (ctx, { sessionToken, taskId, title }) => {
    await requireAuth(ctx, sessionToken);
    const now = Date.now();
    const existing = await ctx.db
      .query("subtasks")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();
    const order = existing.filter((s) => s.deletedAt === undefined).length;
    const id = await ctx.db.insert("subtasks", {
      taskId,
      title: title.slice(0, SUBTITLE_MAX),
      done: false,
      order,
      createdAt: now,
      updatedAt: now,
    });
    // Añadir una pendiente a una tarea que estaba al 100% la baja al % real
    await syncProgressFromSubtasks(ctx, taskId);
    return id;
  },
});

/** Actualiza el título de una sub-tarea. */
export const rename = mutation({
  args: { ...sessionArg, id: v.id("subtasks"), title: v.string() },
  handler: async (ctx, { sessionToken, id, title }) => {
    await requireAuth(ctx, sessionToken);
    await ctx.db.patch(id, { title: title.slice(0, SUBTITLE_MAX), updatedAt: Date.now() });
    return id;
  },
});

/** Marca/desmarca una sub-tarea como completada. */
export const toggle = mutation({
  args: { ...sessionArg, id: v.id("subtasks") },
  handler: async (ctx, { sessionToken, id }) => {
    await requireAuth(ctx, sessionToken);
    const sub = await ctx.db.get(id);
    if (!sub || sub.deletedAt !== undefined)
      throw new Error("Sub-tarea no encontrada");
    const now = Date.now();
    const done = !sub.done;
    await ctx.db.patch(id, {
      done,
      completedAt: done ? now : undefined,
      updatedAt: now,
    });
    // Si quedaron todas completadas → progreso 100% automático
    await syncProgressFromSubtasks(ctx, sub.taskId);

    // ===== Bitácora =====
    // Las sub-tareas son la evidencia granular del avance: una tarea grande
    // que no se completa en toda la semana igual tiene entregables que
    // mostrar, y salen de acá.
    const parent = await ctx.db.get(sub.taskId);
    if (parent) {
      await logEvent(ctx, {
        taskId: sub.taskId,
        kind: done ? "subtask_done" : "subtask_undone",
        task: parent,
        at: now,
        detail: sub.title,
      });
    }
    return id;
  },
});

/**
 * Elimina una sub-tarea (borrado lógico) y recompacta el orden de las restantes.
 * Marca `deletedAt` en vez de borrar físicamente, para que sea recuperable.
 */
export const remove = mutation({
  args: { ...sessionArg, id: v.id("subtasks") },
  handler: async (ctx, { sessionToken, id }) => {
    await requireAuth(ctx, sessionToken);
    const sub = await ctx.db.get(id);
    if (!sub || sub.deletedAt !== undefined) return id;
    const now = Date.now();
    await ctx.db.patch(id, { deletedAt: now, updatedAt: now });

    // Recompactar orden de las restantes (activas)
    const siblings = await ctx.db
      .query("subtasks")
      .withIndex("by_task", (q) => q.eq("taskId", sub.taskId))
      .collect()
      .then((r) =>
        r.filter((s) => s.deletedAt === undefined).sort((a, b) => a.order - b.order),
      );
    await Promise.all(
      siblings.map((s, i) =>
        ctx.db.patch(s._id, { order: i, updatedAt: Date.now() }),
      ),
    );
    // Al borrar una pendiente puede que ya estén todas completadas
    await syncProgressFromSubtasks(ctx, sub.taskId);
    return id;
  },
});

/** Reordena sub-tareas dentro de una tarea (drag). */
export const reorder = mutation({
  args: {
    ...sessionArg,
    id: v.id("subtasks"),
    newOrder: v.number(),
  },
  handler: async (ctx, { sessionToken, id, newOrder }) => {
    await requireAuth(ctx, sessionToken);
    const sub = await ctx.db.get(id);
    if (!sub || sub.deletedAt !== undefined)
      throw new Error("Sub-tarea no encontrada");
    const now = Date.now();

    const siblings = (
      await ctx.db
        .query("subtasks")
        .withIndex("by_task", (q) => q.eq("taskId", sub.taskId))
        .collect()
    )
      .filter((s) => s._id !== id && s.deletedAt === undefined)
      .sort((a, b) => a.order - b.order);

    siblings.splice(newOrder, 0, null as unknown as Doc<"subtasks">);
    await Promise.all(
      siblings.map((s, i) =>
        s === null
          ? ctx.db.patch(id, { order: i, updatedAt: now })
          : ctx.db.patch(s._id, { order: i, updatedAt: now }),
      ),
    );
    return id;
  },
});
