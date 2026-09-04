/**
 * Insights — el dataset de la vista de análisis global.
 *
 * ===== LA IDEA =====
 * Una sola query devuelve TODO lo que la vista necesita para el rango y el
 * área elegidos: tareas (recortadas), eventos de flujo, imprevistos,
 * dayItems y corridas del agente. La agregación (semanas, medianas,
 * correlaciones) vive en el CLIENTE con date-fns en hora local — mismo
 * patrón que catch-ups y panel Hoy: el backend nunca decide qué día es hoy
 * ni dónde empieza una semana.
 *
 * ===== FILTRO DE ÁREA =====
 * tasks y events se filtran por área (events guarda snapshot de área al
 * momento del evento). Los imprevistos y dayItems NO se filtran: los
 * imprevistos no tienen área (son globales por naturaleza) y el plan-vs-real
 * del día mezcla áreas a propósito.
 *
 * ===== VOLUMEN =====
 * Uso unipersonal: del orden de miles de filas como peor caso en "todo el
 * histórico". Si algún día pesa, la agregación de tiempos por estado baja
 * al backend; hoy no lo justifica.
 */

import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireAuth } from "./authGuard";

const sessionArg = { sessionToken: v.string() };

/** Kinds de evento que alimentan métricas de flujo (el resto no aporta). */
const FLOW_KINDS = new Set([
  "created",
  "status",
  "completed",
  "reopened",
  "deleted",
]);

export const dataset = query({
  args: {
    ...sessionArg,
    /** Inicio del rango (ms, hora local del cliente). */
    from: v.number(),
    /** Fin del rango (ms, exclusivo). `from = 0` + `to = Date.now()` = todo. */
    to: v.number(),
    /** "all" o un área concreta para filtrar tasks/events. */
    area: v.union(
      v.literal("all"),
      v.literal("patagonia"),
      v.literal("datacef"),
      v.literal("personal"),
    ),
  },
  handler: async (ctx, { sessionToken, from, to, area }) => {
    await requireAuth(ctx, sessionToken);

    // ---- Tareas: todas las activas + las borradas dentro del rango ------
    // (las borradas antes del rango no aportan nada a las métricas).
    const allTasks = await ctx.db.query("tasks").collect();
    const tasks = allTasks
      .filter((t) => area === "all" || t.area === area)
      .filter(
        // Vive, o murió/nació dentro del rango: la tarea que se completó
        // hace 2 meses pero sigue viva TAMBIÉN cuenta (backlog aging).
        (t) =>
          t.deletedAt === undefined ||
          (t.deletedAt >= from && t.deletedAt < to),
      )
      .map((t) => ({
        id: t._id,
        title: t.title,
        area: t.area,
        status: t.status,
        taskType: t.taskType ?? null,
        executor: t.executor ?? null,
        createdAt: t.createdAt,
        completedAt: t.completedAt ?? null,
        updatedAt: t.updatedAt,
        deletedAt: t.deletedAt ?? null,
        dueDate: t.dueDate ?? null,
        requestedBy: t.requestedBy ?? null,
        clickupId: t.clickupId ?? null,
        clickupProject: t.clickupPath?.listName ?? null,
      }));

    const taskIds = new Set(tasks.map((t) => t.id));

    // ---- Events del rango (solo flujo, solo de estas tareas) ------------
    const eventsRows = await ctx.db
      .query("events")
      .withIndex("by_at", (q) => q.gte("at", from).lt("at", to))
      .collect();
    const events = eventsRows
      .filter((e) => FLOW_KINDS.has(e.kind))
      .filter((e) => taskIds.has(e.taskId))
      .map((e) => ({
        taskId: e.taskId,
        kind: e.kind as string,
        at: e.at,
        from: e.fromStatus ?? null,
        to: e.toStatus ?? null,
      }));

    // ---- Imprevistos + dayItems del rango (sin filtro de área) ----------
    const impRows = await ctx.db
      .query("imprevistos")
      .withIndex("by_day", (q) => q.gte("day", from).lt("day", to))
      .collect();
    const imprevistos = impRows
      .filter((r) => r.deletedAt === undefined)
      .map((r) => ({
        id: r._id,
        title: r.title,
        day: r.day,
        resolvedAt: r.resolvedAt ?? null,
        promotedAt: r.promotedAt ?? null,
        promotedTaskId: r.promotedTaskId ?? null,
      }));

    const dayItems = (
      await ctx.db
        .query("dayItems")
        .withIndex("by_day", (q) => q.gte("day", from).lt("day", to))
        .collect()
    ).map((r) => ({ taskId: r.taskId, day: r.day }));

    // ---- Corridas del agente (duración/éxito; el taskId ata a la tarea) --
    const runsRows = await ctx.db.query("agentRuns").collect();
    const agentRuns = runsRows
      .filter((r) => r.startedAt >= from && r.startedAt < to)
      .map((r) => ({
        taskId: r.taskId,
        model: r.model ?? null,
        startedAt: r.startedAt,
        endedAt: r.endedAt ?? null,
        state: r.state as string,
        exitCode: r.exitCode ?? null,
      }));

    return { tasks, events, imprevistos, dayItems, agentRuns };
  },
});
