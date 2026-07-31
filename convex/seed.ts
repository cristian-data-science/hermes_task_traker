import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAdminToken } from "./authGuard";

/**
 * Mutation de seed: borra todas las tareas/sub-tareas existentes
 * y crea las del snapshot inicial del archivo tareas-pendientes.md.
 *
 * Se invoca desde el script `npm run seed` (scripts/seed.ts), que pasa el
 * `HERMES_ADMIN_TOKEN` leído de `.env.local`.
 *
 * 🔒 Requiere `adminToken`: sin él, cualquiera podría vaciar la base de datos
 *    llamando a esta mutation desde Internet. El token se valida contra la
 *    env var HERMES_ADMIN_TOKEN del servidor (comparación timing-safe).
 *
 * ⚠️ Borra TODA la data existente antes de importar.
 */
export const resetAndSeed = mutation({
  args: {
    adminToken: v.string(),
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
          v.literal("en-curso"),
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
  handler: async (ctx, { adminToken, tasks }) => {
    // 0) Verificar token de administración ANTES de cualquier borrado.
    requireAdminToken(adminToken);

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
