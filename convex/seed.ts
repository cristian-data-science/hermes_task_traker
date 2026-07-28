import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Mutation de seed: borra todas las tareas/sub-tareas existentes
 * y crea las del snapshot inicial del archivo tareas-pendientes.md.
 *
 * Se invoca desde el script `npm run seed` (scripts/seed.ts).
 * Es una mutation pública de un solo uso (no se expone en la UI).
 *
 * ⚠️ Borra TODA la data existente antes de importar.
 */
export const resetAndSeed = mutation({
  args: {
    tasks: v.array(
      v.object({
        title: v.string(),
        area: v.union(
          v.literal("patagonia"),
          v.literal("datacef"),
          v.literal("personal"),
        ),
        status: v.union(
          v.literal("urgente"),
          v.literal("pendiente"),
          v.literal("baja"),
          v.literal("standby"),
          v.literal("programado"),
          v.literal("completado"),
        ),
        notes: v.optional(v.string()),
        executor: v.optional(
          v.union(v.literal("cris"), v.literal("claw")),
        ),
        estimate: v.optional(v.string()),
        dueDate: v.optional(v.string()),
        progress: v.optional(v.number()),
        standbyFrom: v.optional(v.string()),
        standbyUntil: v.optional(v.string()),
        scheduledDates: v.optional(v.string()),
        requestedBy: v.optional(v.string()),
        completedAt: v.optional(v.number()),
        subtasks: v.optional(
          v.array(
            v.object({
              title: v.string(),
              done: v.boolean(),
            }),
          ),
        ),
      }),
    ),
  },
  handler: async (ctx, { tasks }) => {
    // 1) Borrar todo lo existente
    const existingTasks = await ctx.db.query("tasks").collect();
    const existingSubs = await ctx.db.query("subtasks").collect();
    await Promise.all([
      ...existingSubs.map((s) => ctx.db.delete(s._id)),
      ...existingTasks.map((t) => ctx.db.delete(t._id)),
    ]);

    // 2) Crear las nuevas, agrupando por estado para asignar order
    const orderCounters: Record<string, number> = {};
    const now = Date.now();

    for (const t of tasks) {
      const status = t.status;
      if (orderCounters[status] === undefined) orderCounters[status] = 0;
      const order = orderCounters[status];
      orderCounters[status] += 1;

      const taskId = await ctx.db.insert("tasks", {
        title: t.title,
        area: t.area,
        status,
        notes: t.notes,
        executor: t.executor,
        estimate: t.estimate,
        dueDate: t.dueDate,
        progress: t.progress,
        standbyFrom: t.standbyFrom,
        standbyUntil: t.standbyUntil,
        scheduledDates: t.scheduledDates,
        requestedBy: t.requestedBy,
        order,
        completedAt:
          t.completedAt ?? (status === "completado" ? now : undefined),
        createdAt: now,
        updatedAt: now,
      });

      // Sub-tareas
      if (t.subtasks) {
        for (let i = 0; i < t.subtasks.length; i++) {
          const s = t.subtasks[i];
          await ctx.db.insert("subtasks", {
            taskId,
            title: s.title,
            done: s.done,
            completedAt: s.done ? now : undefined,
            order: i,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }

    return {
      createdTasks: tasks.length,
      createdSubtasks: tasks.reduce(
        (acc, t) => acc + (t.subtasks?.length ?? 0),
        0,
      ),
    };
  },
});
