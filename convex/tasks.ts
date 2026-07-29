import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

/** Literales de área y estado para reutilizar en validaciones. */
const areaUnion = v.union(
  v.literal("patagonia"),
  v.literal("datacef"),
  v.literal("personal"),
);
const statusUnion = v.union(
  v.literal("urgente"),
  v.literal("pendiente"),
  v.literal("baja"),
  v.literal("standby"),
  v.literal("programado"),
  v.literal("completado"),
);

/**
 * =====================
 *  QUERIES (lectura)
 * =====================
 */

/** Lista todas las tareas, ordenadas por orden. */
export const list = query({
  args: {},
  handler: async (ctx): Promise<Doc<"tasks">[]> => {
    return await ctx.db.query("tasks").order("asc").collect();
  },
});

/** Lista las tareas de una área concreta. */
export const listByArea = query({
  args: { area: areaUnion },
  handler: async (ctx, { area }) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_area", (q) => q.eq("area", area))
      .order("asc")
      .collect();
  },
});

/** Lista las tareas por estado (para columnas del Kanban). */
export const listByStatus = query({
  args: { status: statusUnion },
  handler: async (ctx, { status }) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", status))
      .order("asc")
      .collect();
  },
});

/** Obtiene una tarea por id. */
export const get = query({
  args: { id: v.id("tasks") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

/**
 * =====================
 *  MUTATIONS (escritura)
 * =====================
 */

/** Tipo para los campos editables de una tarea. */
const taskFields = {
  title: v.string(),
  area: areaUnion,
  status: statusUnion,
  notes: v.optional(v.string()),
  /** Ejecutor: Cris (tú) o Claw (agente). Por defecto Cris. */
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
};

/** Crea una nueva tarea. `order` se asigna al final de su estado. */
export const create = mutation({
  args: taskFields,
  handler: async (ctx, args) => {
    const now = Date.now();
    // Contar tareas existentes en ese estado para ponerla al final
    const existing = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .collect();
    const order = existing.length;

    const taskId = await ctx.db.insert("tasks", {
      ...args,
      order,
      completedAt:
        args.status === "completado" ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });
    return taskId;
  },
});

/** Actualiza una tarea existente. Solo muta `updatedAt` y los campos pasados. */
export const update = mutation({
  args: {
    id: v.id("tasks"),
    title: v.optional(v.string()),
    area: v.optional(areaUnion),
    status: v.optional(statusUnion),
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
  },
  handler: async (ctx, { id, ...patch }) => {
    const task = await ctx.db.get(id);
    if (!task) throw new Error("Tarea no encontrada");
    const now = Date.now();

    const next: Record<string, unknown> = { ...patch, updatedAt: now };

    // Si cambia a "completado", marcar fecha de completado.
    if (patch.status === "completado" && !task.completedAt) {
      next.completedAt = now;
    }
    // Si sale de "completado", limpiar la fecha.
    if (patch.status && patch.status !== "completado") {
      next.completedAt = undefined;
    }

    await ctx.db.patch(id, next);
    return id;
  },
});

/** Elimina una tarea y todas sus sub-tareas. */
export const remove = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, { id }) => {
    // Borrar sub-tareas asociadas
    const subtasks = await ctx.db
      .query("subtasks")
      .withIndex("by_task", (q) => q.eq("taskId", id))
      .collect();
    await Promise.all(subtasks.map((s) => ctx.db.delete(s._id)));
    await ctx.db.delete(id);
    return id;
  },
});

/**
 * Cambia el estado de una tarea y reordena las columnas afectadas.
 * Se usa al arrastrar tarjetas en el Kanban.
 *
 * @param id        id de la tarea movida
 * @param newStatus estado destino
 * @param newOrder  posición destino dentro de newStatus
 */
export const changeStatus = mutation({
  args: {
    id: v.id("tasks"),
    newStatus: statusUnion,
    newOrder: v.number(),
  },
  handler: async (ctx, { id, newStatus, newOrder }) => {
    const task = await ctx.db.get(id);
    if (!task) throw new Error("Tarea no encontrada");
    const now = Date.now();
    const oldStatus = task.status;

    // 1) Reordenar columna origen: quitar la tarea y compactar
    if (oldStatus !== newStatus) {
      const sourceCol = await ctx.db
        .query("tasks")
        .withIndex("by_status", (q) => q.eq("status", oldStatus))
        .collect();
      const sorted = sourceCol
        .filter((t) => t._id !== id)
        .sort((a, b) => a.order - b.order);
      await Promise.all(
        sorted.map((t, i) => ctx.db.patch(t._id, { order: i, updatedAt: now })),
      );
    }

    // 2) Reordenar columna destino: hacer espacio en newOrder
    const destCol = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", newStatus))
      .collect();
    const destSorted = destCol
      .filter((t) => t._id !== id)
      .sort((a, b) => a.order - b.order);

    // Insertar en newOrder y reindexar
    destSorted.splice(newOrder, 0, null as unknown as Doc<"tasks">);
    const updates: Promise<unknown>[] = [];
    destSorted.forEach((t, i) => {
      if (t === null) {
        // placeholder para la tarea movida
        updates.push(
          ctx.db.patch(id, {
            status: newStatus,
            order: i,
            updatedAt: now,
            completedAt:
              newStatus === "completado" ? now : undefined,
          }),
        );
      } else {
        updates.push(
          ctx.db.patch(t._id, { order: i, updatedAt: now }),
        );
      }
    });
    await Promise.all(updates);
    return id;
  },
});

/**
 * Reordena tareas dentro de un mismo estado (drag dentro de la misma columna).
 */
export const reorderWithinStatus = mutation({
  args: {
    id: v.id("tasks"),
    newOrder: v.number(),
  },
  handler: async (ctx, { id, newOrder }) => {
    const task = await ctx.db.get(id);
    if (!task) throw new Error("Tarea no encontrada");
    const status = task.status;
    const now = Date.now();

    const col = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", status))
      .collect();
    const sorted = col
      .filter((t) => t._id !== id)
      .sort((a, b) => a.order - b.order);

    sorted.splice(newOrder, 0, null as unknown as Doc<"tasks">);
    await Promise.all(
      sorted.map((t, i) =>
        t === null
          ? ctx.db.patch(id, { order: i, updatedAt: now })
          : ctx.db.patch(t._id, { order: i, updatedAt: now }),
      ),
    );
    return id;
  },
});

/**
 * Marca/desmarca una tarea como completada rápidamente.
 * Reasigna `order` para que la tarea vaya al INICIO (order 0) de la columna
 * destino — así lo más recientemente completado queda arriba — y compacta la
 * columna origen para no dejar huecos ni colisiones de orden.
 */
export const toggleComplete = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, { id }) => {
    const task = await ctx.db.get(id);
    if (!task) throw new Error("Tarea no encontrada");
    const now = Date.now();
    const oldStatus = task.status;
    const newStatus: "completado" | "pendiente" =
      oldStatus === "completado" ? "pendiente" : "completado";

    // Misma columna no debería darse (toggle siempre cruza), pero por seguridad.
    if (oldStatus === newStatus) return id;

    // 1) Compactar columna origen: quitar la tarea y reindexar 0..n.
    const sourceCol = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", oldStatus))
      .collect();
    const sourceSorted = sourceCol
      .filter((t) => t._id !== id)
      .sort((a, b) => a.order - b.order);
    await Promise.all(
      sourceSorted.map((t, i) =>
        ctx.db.patch(t._id, { order: i, updatedAt: now }),
      ),
    );

    // 2) Insertar al INICIO (order 0) de la columna destino, empujando las
    //    existentes hacia abajo (+1) para evitar colisiones de order.
    const destCol = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", newStatus))
      .collect();
    const destSorted = destCol
      .filter((t) => t._id !== id)
      .sort((a, b) => a.order - b.order);
    await Promise.all(
      destSorted.map((t, i) =>
        ctx.db.patch(t._id, { order: i + 1, updatedAt: now }),
      ),
    );

    await ctx.db.patch(id, {
      status: newStatus,
      order: 0,
      completedAt: newStatus === "completado" ? now : undefined,
      updatedAt: now,
    });
    return id;
  },
});

/**
 * Mutation interna usada por el seed (no expuesta al cliente).
 */
export const _createForSeed = internalMutation({
  args: {
    ...taskFields,
    completedAt: v.optional(v.number()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("tasks", {
      title: args.title,
      area: args.area,
      status: args.status,
      notes: args.notes,
      estimate: args.estimate,
      dueDate: args.dueDate,
      progress: args.progress,
      standbyFrom: args.standbyFrom,
      standbyUntil: args.standbyUntil,
      scheduledDates: args.scheduledDates,
      requestedBy: args.requestedBy,
      order: args.order ?? 0,
      completedAt: args.completedAt,
      createdAt: now,
      updatedAt: now,
    });
  },
});
