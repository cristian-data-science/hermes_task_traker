/**
 * Panel Hoy — dayItems: los punteros "esta tarea está en la lista del día X".
 *
 * ===== LA IDEA =====
 * La lista del día es un WORKING SET armado a la mañana: tareas de cualquier
 * estado del Kanban que hoy quieren atención. Agregar al día NO toca la tarea
 * (ni estado, ni order, ni ClickUp): el dayItem es solo un puntero con orden
 * propio dentro del día.
 *
 * El borrado es lógico a propósito: quitar una tarea del día no borra el
 * histórico de que fue planeada ese día — los insights plan-vs-real lo
 * necesitan aunque a mitad de mañana la sacaras de la lista.
 *
 * ===== ZONAS HORARIAS =====
 * Igual que catchups: el cliente calcula `day` (medianoche local, DST-safe
 * con startOfDay de catchupConfig) y el backend solo compara números.
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAuth } from "./authGuard";

const sessionArg = { sessionToken: v.string() };

/**
 * Lista los dayItems de un día (incluye los borrados lógicamente NO: la vista
 * del panel solo quiere los activos; los borrados quedan para los insights,
 * que leen la tabla con la query de stats de imprevistos.ts).
 */
export const listByDay = query({
  args: { ...sessionArg, day: v.number() },
  handler: async (ctx, { sessionToken, day }) => {
    await requireAuth(ctx, sessionToken);
    const rows = await ctx.db
      .query("dayItems")
      .withIndex("by_day", (q) => q.eq("day", day))
      .order("asc")
      .collect();
    return rows.filter((r) => r.deletedAt === undefined);
  },
});

/**
 * Lista los dayItems de un rango de días [from, to) — para los insights
 * plan-vs-real (cuántas se planificaron por día y cuándo se completaron).
 */
export const listRange = query({
  args: { ...sessionArg, from: v.number(), to: v.number() },
  handler: async (ctx, { sessionToken, from, to }) => {
    await requireAuth(ctx, sessionToken);
    const rows = await ctx.db
      .query("dayItems")
      .withIndex("by_day", (q) => q.gte("day", from).lt("day", to))
      .order("asc")
      .collect();
    // Incluye borrados: "la planeaste y la sacaste" también es un dato del
    // día (a efectos de plan-vs-real contó como planeada).
    return rows;
  },
});

/**
 * Agrega una tarea al día. Los nuevos quedan ARRIBA (order 0), igual que las
 * tasks nuevas de una columna: lo que acabás de decidir se ve primero.
 * Idempotente por (taskId, day): si ya estaba, no hace nada.
 */
export const add = mutation({
  args: { ...sessionArg, day: v.number(), taskId: v.id("tasks") },
  handler: async (ctx, { sessionToken, day, taskId }) => {
    await requireAuth(ctx, sessionToken);
    // ¿Ya está en el día (aunque esté borrado lógico)? Si fue quitada y se
    // vuelve a agregar, revivimos el row para no perder el carriedFrom.
    const existing = await ctx.db
      .query("dayItems")
      .withIndex("by_task", (q) => q.eq("taskId", taskId).eq("day", day))
      .first();
    const now = Date.now();
    if (existing) {
      if (existing.deletedAt === undefined) return existing._id;
      await ctx.db.patch(existing._id, { deletedAt: undefined, updatedAt: now });
      return existing._id;
    }

    // Desplazar +1 los ítems actuales del día para dejar order 0 arriba.
    const dayRows = await ctx.db
      .query("dayItems")
      .withIndex("by_day", (q) => q.eq("day", day))
      .collect();
    const active = dayRows
      .filter((r) => r.deletedAt === undefined)
      .sort((a, b) => a.order - b.order);
    await Promise.all(
      active.map((r, i) => ctx.db.patch(r._id, { order: i + 1, updatedAt: now })),
    );

    return await ctx.db.insert("dayItems", {
      day,
      taskId,
      order: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Quita un ítem del día (borrado lógico: la tarea no se toca para nada).
 */
export const remove = mutation({
  args: { ...sessionArg, id: v.id("dayItems") },
  handler: async (ctx, { sessionToken, id }) => {
    await requireAuth(ctx, sessionToken);
    await ctx.db.patch(id, { deletedAt: Date.now(), updatedAt: Date.now() });
  },
});

/**
 * Reordena el día: el cliente manda la lista COMPLETA de ids activos en el
 * orden final y se reindexa 0..n. Mucho más simple (y a prueba de huecos)
 * que reproducir el splice de changeStatus para una lista chica.
 */
export const reorder = mutation({
  args: { ...sessionArg, ids: v.array(v.id("dayItems")) },
  handler: async (ctx, { sessionToken, ids }) => {
    await requireAuth(ctx, sessionToken);
    const now = Date.now();
    await Promise.all(
      ids.map((id, i) => ctx.db.patch(id, { order: i, updatedAt: now })),
    );
  },
});

/**
 * "Traer pendientes de ayer": copia al día `toDay` los dayItems de `fromDay`
 * cuya tarea sigue viva y NO completada, y que no estén ya en `toDay`.
 * Los nuevos ítems se agregan AL FINAL (lo arrastrado va después de lo que ya
 * armaste hoy) y marcan carriedFrom para poder distinguir arrastre de
 * planificación original en las métricas.
 *
 * Devuelve cuántos ítems copió (0 = no había pendientes elegibles).
 */
export const carryOverFrom = mutation({
  args: { ...sessionArg, fromDay: v.number(), toDay: v.number() },
  handler: async (ctx, { sessionToken, fromDay, toDay }) => {
    await requireAuth(ctx, sessionToken);
    if (fromDay >= toDay) throw new Error("carryOver: fromDay debe ser anterior a toDay");

    const yesterday = await ctx.db
      .query("dayItems")
      .withIndex("by_day", (q) => q.eq("day", fromDay))
      .collect();
    const today = await ctx.db
      .query("dayItems")
      .withIndex("by_day", (q) => q.eq("day", toDay))
      .collect();
    const todayTaskIds = new Set(
      today.filter((r) => r.deletedAt === undefined).map((r) => r.taskId),
    );

    // Orden final del día: los ítems existentes conservan su lugar, los
    // traídos se appending después del último order activo.
    const maxOrder = today
      .filter((r) => r.deletedAt === undefined)
      .reduce((max, r) => Math.max(max, r.order), -1);

    const now = Date.now();
    let nextOrder = maxOrder + 1;
    let copied = 0;
    for (const item of yesterday) {
      if (item.deletedAt !== undefined) continue;
      if (todayTaskIds.has(item.taskId)) continue;
      const task = await ctx.db.get(item.taskId);
      if (!task || task.deletedAt !== undefined) continue;
      if (task.status === "completado") continue;
      await ctx.db.insert("dayItems", {
        day: toDay,
        taskId: item.taskId,
        order: nextOrder++,
        carriedFrom: item._id,
        createdAt: now,
        updatedAt: now,
      });
      copied++;
    }
    return copied;
  },
});
