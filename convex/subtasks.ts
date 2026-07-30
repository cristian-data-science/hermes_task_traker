import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/**
 * Sincroniza el progreso de la tarea padre con sus sub-tareas.
 *
 * Reglas:
 *  - Todas las sub-tareas completadas → progreso 100%.
 *  - Si venía en 100% y se desmarca alguna → recalcula al % real
 *    (así el slider no se queda "mintiendo" en 100).
 *  - En cualquier otro caso se respeta el valor manual del slider.
 */
async function syncProgressFromSubtasks(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
) {
  const subs = await ctx.db
    .query("subtasks")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();
  if (subs.length === 0) return;

  const done = subs.filter((s) => s.done).length;
  const pct = Math.round((done / subs.length) * 100);

  const task = await ctx.db.get(taskId);
  if (!task) return;

  const allDone = done === subs.length;
  const wasFull = (task.progress ?? 0) === 100;
  if (!allDone && !wasFull) return; // respetar el valor manual

  if (task.progress !== pct) {
    await ctx.db.patch(taskId, { progress: pct, updatedAt: Date.now() });
  }
}

/**
 * Devuelve los conteos de sub-tareas {done, total} agrupados por taskId.
 * Una sola query para alimentar a todos los TaskCards.
 */
export const allCounts = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("subtasks").collect();
    const map: Record<string, { done: number; total: number }> = {};
    for (const s of all) {
      const key = s.taskId;
      if (!map[key]) map[key] = { done: 0, total: 0 };
      map[key].total += 1;
      if (s.done) map[key].done += 1;
    }
    return map;
  },
});

/** Lista las sub-tareas de una tarea, ordenadas. */
export const listByTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }): Promise<Doc<"subtasks">[]> => {
    return await ctx.db
      .query("subtasks")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .order("asc")
      .collect();
  },
});

/** Crea una sub-tarea al final de la lista de la tarea padre. */
export const create = mutation({
  args: { taskId: v.id("tasks"), title: v.string() },
  handler: async (ctx, { taskId, title }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("subtasks")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();
    const order = existing.length;
    const id = await ctx.db.insert("subtasks", {
      taskId,
      title,
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
  args: { id: v.id("subtasks"), title: v.string() },
  handler: async (ctx, { id, title }) => {
    await ctx.db.patch(id, { title, updatedAt: Date.now() });
    return id;
  },
});

/** Marca/desmarca una sub-tarea como completada. */
export const toggle = mutation({
  args: { id: v.id("subtasks") },
  handler: async (ctx, { id }) => {
    const sub = await ctx.db.get(id);
    if (!sub) throw new Error("Sub-tarea no encontrada");
    const now = Date.now();
    const done = !sub.done;
    await ctx.db.patch(id, {
      done,
      completedAt: done ? now : undefined,
      updatedAt: now,
    });
    // Si quedaron todas completadas → progreso 100% automático
    await syncProgressFromSubtasks(ctx, sub.taskId);
    return id;
  },
});

/** Elimina una sub-tarea y recompacta el orden de las restantes. */
export const remove = mutation({
  args: { id: v.id("subtasks") },
  handler: async (ctx, { id }) => {
    const sub = await ctx.db.get(id);
    if (!sub) return id;
    await ctx.db.delete(id);

    // Recompactar orden de las restantes
    const siblings = await ctx.db
      .query("subtasks")
      .withIndex("by_task", (q) => q.eq("taskId", sub.taskId))
      .collect()
      .then((r) => r.sort((a, b) => a.order - b.order));
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
    id: v.id("subtasks"),
    newOrder: v.number(),
  },
  handler: async (ctx, { id, newOrder }) => {
    const sub = await ctx.db.get(id);
    if (!sub) throw new Error("Sub-tarea no encontrada");
    const now = Date.now();

    const siblings = (
      await ctx.db
        .query("subtasks")
        .withIndex("by_task", (q) => q.eq("taskId", sub.taskId))
        .collect()
    )
      .filter((s) => s._id !== id)
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
