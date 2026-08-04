import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAuth } from "./authGuard";
import { internal } from "./_generated/api";

/** Literales de área y estado para reutilizar en validaciones. */
const areaUnion = v.union(
  v.literal("patagonia"),
  v.literal("datacef"),
  v.literal("personal"),
);
const statusUnion = v.union(
  v.literal("urgente"),
  v.literal("pendiente"),
  v.literal("en-curso"),
  v.literal("standby"),
  v.literal("programado"),
  v.literal("completado"),
);

/** Argumento de sesión obligatorio en toda función pública. */
const sessionArg = { sessionToken: v.string() };

/** Límites de longitud para textos libres (anti-abuso de almacenamiento). */
const TITLE_MAX = 200;
const NOTES_MAX = 5000;
const TEXT_MAX = 100;

/** Sanea y valida los campos de texto antes de persistirlos. */
function sanitizeTaskText(input: {
  title?: string;
  notes?: string;
  requestedBy?: string;
}) {
  const out: Record<string, string> = {};
  if (input.title !== undefined) {
    out.title = input.title.slice(0, TITLE_MAX);
  }
  if (input.notes !== undefined) {
    out.notes = input.notes.slice(0, NOTES_MAX);
  }
  if (input.requestedBy !== undefined) {
    out.requestedBy = input.requestedBy.slice(0, TEXT_MAX);
  }
  return out;
}

/** Clamp del progreso al rango válido 0-100 (no confiar en el HTML). */
function clampProgress(n: number | undefined): number | undefined {
  if (n === undefined) return undefined;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * =====================
 *  QUERIES (lectura)
 * =====================
 */

/** Lista todas las tareas activas (no borradas), ordenadas por orden. */
export const list = query({
  args: sessionArg,
  handler: async (ctx, { sessionToken }): Promise<Doc<"tasks">[]> => {
    await requireAuth(ctx, sessionToken);
    const all = await ctx.db.query("tasks").order("asc").collect();
    return all.filter((t) => t.deletedAt === undefined);
  },
});

/** Lista las tareas activas de una área concreta. */
export const listByArea = query({
  args: { ...sessionArg, area: areaUnion },
  handler: async (ctx, { sessionToken, area }) => {
    await requireAuth(ctx, sessionToken);
    const all = await ctx.db
      .query("tasks")
      .withIndex("by_area", (q) => q.eq("area", area))
      .order("asc")
      .collect();
    return all.filter((t) => t.deletedAt === undefined);
  },
});

/** Lista las tareas activas por estado (para columnas del Kanban). */
export const listByStatus = query({
  args: { ...sessionArg, status: statusUnion },
  handler: async (ctx, { sessionToken, status }) => {
    await requireAuth(ctx, sessionToken);
    const all = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", status))
      .order("asc")
      .collect();
    return all.filter((t) => t.deletedAt === undefined);
  },
});

/** Obtiene una tarea por id (null si está borrada). */
export const get = query({
  args: { ...sessionArg, id: v.id("tasks") },
  handler: async (ctx, { sessionToken, id }) => {
    await requireAuth(ctx, sessionToken);
    const task = await ctx.db.get(id);
    if (!task || task.deletedAt !== undefined) return null;
    return task;
  },
});

/**
 * =====================
 *  HELPERS INTERNOS
 * =====================
 */

/**
 * Mueve una tarea al INICIO (order 0) de `newStatus`.
 * - Compacta la columna origen (reindexa 0..n sin huecos).
 * - Desplaza las tareas de la columna destino +1 y deja la movida en order 0.
 * - `extraPatch` permite ajustar campos adicionales (ej. completedAt).
 *
 * Se usa para "poner arriba" cuando una tarea cambia de estado por medios
 * que NO son drag (modal, toggleComplete): lo reciente queda visible arriba.
 */
async function moveToTopOfStatus(
  ctx: MutationCtx,
  id: Id<"tasks">,
  oldStatus: Doc<"tasks">["status"],
  newStatus: Doc<"tasks">["status"],
  now: number,
  extraPatch: Record<string, unknown> = {},
) {
  if (oldStatus === newStatus) return;

  // 1) Compactar columna origen: quitar la tarea y reindexar 0..n.
  const sourceCol = await ctx.db
    .query("tasks")
    .withIndex("by_status", (q) => q.eq("status", oldStatus))
    .collect();
  const sourceSorted = sourceCol
    .filter((t) => t._id !== id && t.deletedAt === undefined)
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
    .filter((t) => t._id !== id && t.deletedAt === undefined)
    .sort((a, b) => a.order - b.order);
  await Promise.all(
    destSorted.map((t, i) =>
      ctx.db.patch(t._id, { order: i + 1, updatedAt: now }),
    ),
  );

  await ctx.db.patch(id, {
    status: newStatus,
    order: 0,
    updatedAt: now,
    ...extraPatch,
  });
}

/**
 * =====================
 *  MUTATIONS (escritura)
 * =====================
 */

/** Tipo para los campos editables de una tarea. */
const taskFields = {
  ...sessionArg,
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
  /**
   * Destino ClickUp (solo área patagonia). Vacío → Mesa Técnica (tarea suelta).
   * Seteado → id del nodo padre bajo el que anidar la tarea en ClickUp.
   */
  clickupParentId: v.optional(v.string()),
};

/** Crea una nueva tarea. `order` se asigna al INICIO (order 0) de su estado. */
export const create = mutation({
  args: taskFields,
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.sessionToken);
    const now = Date.now();
    const sanitized = sanitizeTaskText(args);
    // Desplazar las tareas existentes del estado +1 para dejar order 0 libre
    // arriba (lo nuevo se ve primero).
    const existing = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .collect();
    const sorted = existing
      .filter((t) => t.deletedAt === undefined)
      .sort((a, b) => a.order - b.order);
    await Promise.all(
      sorted.map((t, i) =>
        ctx.db.patch(t._id, { order: i + 1, updatedAt: now }),
      ),
    );

    const taskId = await ctx.db.insert("tasks", {
      title: sanitized.title ?? args.title,
      area: args.area,
      status: args.status,
      notes: sanitized.notes ?? args.notes,
      executor: args.executor,
      estimate: args.estimate,
      dueDate: args.dueDate,
      progress: clampProgress(args.progress),
      standbyFrom: args.standbyFrom,
      standbyUntil: args.standbyUntil,
      scheduledDates: args.scheduledDates,
      requestedBy: sanitized.requestedBy ?? args.requestedBy,
      clickupParentId: args.clickupParentId,
      order: 0,
      completedAt: args.status === "completado" ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });

    // ===== Sync ClickUp outbound (solo patagonia) =====
    // El handler del scheduler valida enabled/área internamente; agendamos
    // sin más para que corra en background sin bloquear el retorno.
    if (args.area === "patagonia") {
      await ctx.scheduler.runAfter(0, internal.clickup.syncTask, {
        sessionToken: args.sessionToken,
        taskId,
        op: "create",
      });
    }
    return taskId;
  },
});

/** Actualiza una tarea existente. Solo muta `updatedAt` y los campos pasados. */
export const update = mutation({
  args: {
    ...sessionArg,
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
    clickupParentId: v.optional(v.string()),
  },
  handler: async (ctx, { sessionToken, id, ...patch }) => {
    await requireAuth(ctx, sessionToken);
    const task = await ctx.db.get(id);
    if (!task || task.deletedAt !== undefined)
      throw new Error("Tarea no encontrada");
    const now = Date.now();

    // Sanea textos y clamp del progreso antes de aplicarlos.
    const sanitized = sanitizeTaskText(patch);
    if (sanitized.title !== undefined) patch.title = sanitized.title;
    if (sanitized.notes !== undefined) patch.notes = sanitized.notes;
    if (sanitized.requestedBy !== undefined)
      patch.requestedBy = sanitized.requestedBy;
    if (patch.progress !== undefined) patch.progress = clampProgress(patch.progress);

    // Separar el cambio de estado del resto del patch.
    const { status: newStatus, ...restPatch } = patch;

    // Si cambia el destino ClickUp y la tarea ya estaba sincronizada, la
    // desvinculamos para que el próximo sync la recree en el nuevo destino.
    if (
      task.clickupId &&
      patch.clickupParentId !== undefined &&
      patch.clickupParentId !== task.clickupParentId
    ) {
      await ctx.db.patch(id, {
        clickupId: undefined,
        clickupUrl: undefined,
        clickupSyncedAt: undefined,
      });
    }

    // Determina el op de sync según qué cambió. Si cambia de área fuera de
    // patagonia, no hay nada que sincronizar (lo manejamos tras el patch).
    let syncOp: "update" | "status" | null = null;
    if (newStatus && newStatus !== task.status) {
      syncOp = "status";
    } else {
      syncOp = "update";
    }

    // Si cambia el estado (desde el modal, NO via drag), mover la tarea
    // ARRIBA (order 0) de la nueva columna + aplicar el resto de campos.
    if (newStatus && newStatus !== task.status) {
      const extra: Record<string, unknown> = { ...restPatch };
      if (newStatus === "completado" && !task.completedAt) {
        extra.completedAt = now;
      }
      if (newStatus !== "completado") {
        extra.completedAt = undefined;
      }
      await moveToTopOfStatus(ctx, id, task.status, newStatus, now, extra);
    } else {
      // Sin cambio de estado: patch plano (mantiene el order actual).
      const next: Record<string, unknown> = { ...patch, updatedAt: now };
      if (patch.status === "completado" && !task.completedAt) {
        next.completedAt = now;
      }
      if (patch.status && patch.status !== "completado") {
        next.completedAt = undefined;
      }
      await ctx.db.patch(id, next);
    }

    // ===== Sync ClickUp outbound (solo patagonia) =====
    // El área final puede haber cambiado: releemos para decidir.
    const updated = await ctx.db.get(id);
    if (updated && updated.area === "patagonia") {
      await ctx.scheduler.runAfter(0, internal.clickup.syncTask, {
        sessionToken,
        taskId: id,
        op: syncOp ?? "update",
      });
    } else if (updated && updated.clickupId) {
      // Salió de patagonia pero estaba sincronizada: desvincular sin borrar.
      await ctx.db.patch(id, {
        clickupId: undefined,
        clickupUrl: undefined,
        clickupSyncedAt: now,
        clickupSyncError: undefined,
      });
    }
    return id;
  },
});

/**
 * Elimina una tarea (borrado lógico / soft-delete) y oculta sus sub-tareas.
 * Marca `deletedAt` en la tarea y todas sus sub-tareas, sin borrar físicamente.
 * Esto hace el borrado recuperable frente a accidentes o abuso.
 */
export const remove = mutation({
  args: { ...sessionArg, id: v.id("tasks") },
  handler: async (ctx, { sessionToken, id }) => {
    await requireAuth(ctx, sessionToken);
    const now = Date.now();
    const task = await ctx.db.get(id);
    if (!task || task.deletedAt !== undefined)
      throw new Error("Tarea no encontrada");
    // Marcar sub-tareas asociadas como borradas
    const subtasks = await ctx.db
      .query("subtasks")
      .withIndex("by_task", (q) => q.eq("taskId", id))
      .collect();
    await Promise.all(
      subtasks
        .filter((s) => s.deletedAt === undefined)
        .map((s) => ctx.db.patch(s._id, { deletedAt: now, updatedAt: now })),
    );
    await ctx.db.patch(id, { deletedAt: now, updatedAt: now });

    // ===== Sync ClickUp: eliminar en ClickUp si estaba sincronizada =====
    // Al borrar en Hermes, borramos también en ClickUp (la tarea vino de acá).
    // El handler de op="delete" hace DELETE a ClickUp y desvincula la tarea.
    if (task.area === "patagonia") {
      await ctx.scheduler.runAfter(0, internal.clickup.syncTask, {
        sessionToken,
        taskId: id,
        op: "delete",
      });
    }
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
    ...sessionArg,
    id: v.id("tasks"),
    newStatus: statusUnion,
    newOrder: v.number(),
  },
  handler: async (ctx, { sessionToken, id, newStatus, newOrder }) => {
    await requireAuth(ctx, sessionToken);
    const task = await ctx.db.get(id);
    if (!task || task.deletedAt !== undefined)
      throw new Error("Tarea no encontrada");
    const now = Date.now();
    const oldStatus = task.status;

    // 1) Reordenar columna origen: quitar la tarea y compactar
    if (oldStatus !== newStatus) {
      const sourceCol = await ctx.db
        .query("tasks")
        .withIndex("by_status", (q) => q.eq("status", oldStatus))
        .collect();
      const sorted = sourceCol
        .filter((t) => t._id !== id && t.deletedAt === undefined)
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
      .filter((t) => t._id !== id && t.deletedAt === undefined)
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

    // ===== Sync ClickUp outbound (solo patagonia, solo si hubo cambio real) =====
    if (oldStatus !== newStatus && task.area === "patagonia" && task.clickupId) {
      await ctx.scheduler.runAfter(0, internal.clickup.syncTask, {
        sessionToken,
        taskId: id,
        op: "status",
      });
    }
    return id;
  },
});

/**
 * Reordena tareas dentro de un mismo estado (drag dentro de la misma columna).
 */
export const reorderWithinStatus = mutation({
  args: {
    ...sessionArg,
    id: v.id("tasks"),
    newOrder: v.number(),
  },
  handler: async (ctx, { sessionToken, id, newOrder }) => {
    await requireAuth(ctx, sessionToken);
    const task = await ctx.db.get(id);
    if (!task || task.deletedAt !== undefined)
      throw new Error("Tarea no encontrada");
    const status = task.status;
    const now = Date.now();

    const col = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", status))
      .collect();
    const sorted = col
      .filter((t) => t._id !== id && t.deletedAt === undefined)
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
 * Usa moveToTopOfStatus para que quede ARRIBA (order 0) de la columna destino.
 */
export const toggleComplete = mutation({
  args: { ...sessionArg, id: v.id("tasks") },
  handler: async (ctx, { sessionToken, id }) => {
    await requireAuth(ctx, sessionToken);
    const task = await ctx.db.get(id);
    if (!task || task.deletedAt !== undefined)
      throw new Error("Tarea no encontrada");
    const now = Date.now();
    const oldStatus = task.status;
    const newStatus = oldStatus === "completado" ? "pendiente" : "completado";
    const completing = newStatus === "completado";

    await moveToTopOfStatus(ctx, id, oldStatus, newStatus, now, {
      completedAt: completing ? now : undefined,
      // Completar la tarea lleva el progreso al 100% automáticamente
      ...(completing ? { progress: 100 } : {}),
    });

    // Marcar completada también marca todas sus sub-tareas (no borradas)
    if (completing) {
      const subs = await ctx.db
        .query("subtasks")
        .withIndex("by_task", (q) => q.eq("taskId", id))
        .collect();
      await Promise.all(
        subs
          .filter((s) => !s.done && s.deletedAt === undefined)
          .map((s) =>
            ctx.db.patch(s._id, { done: true, completedAt: now, updatedAt: now }),
          ),
      );
    }

    // ===== Sync ClickUp outbound (solo patagonia) =====
    if (task.area === "patagonia" && task.clickupId) {
      await ctx.scheduler.runAfter(0, internal.clickup.syncTask, {
        sessionToken,
        taskId: id,
        op: "complete",
      });
    }
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

/**
 * Query interna (sin auth) usada por el scheduler de ClickUp para leer la
 * tarea a sincronizar. El caller (mutación) YA validó la sesión.
 */
export const _getInternal = internalQuery({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task) return null;
    return task;
  },
});
