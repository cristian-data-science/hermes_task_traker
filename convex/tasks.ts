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
import { logEvent, logStatusChange } from "./events";
import { validateDelegation } from "./agent";

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
  /** Ejecutor: Cris (tú), Claw (agente Hermes) o ZCode (agente de código). */
  executor: v.optional(
    v.union(v.literal("cris"), v.literal("claw"), v.literal("zcode")),
  ),
  estimate: v.optional(v.string()),
  dueDate: v.optional(v.string()),
  progress: v.optional(v.number()),
  standbyFrom: v.optional(v.string()),
  standbyUntil: v.optional(v.string()),
  scheduledDates: v.optional(v.string()),
  requestedBy: v.optional(v.string()),
  /**
   * Súper urgente: siempre visible (ignora filtros) y anclada primera.
   * Marca local de visualización; no viaja a ClickUp.
   */
  superUrgent: v.optional(v.boolean()),
  /**
   * Destino ClickUp (solo área patagonia). Vacío → Mesa Técnica (tarea suelta).
   * Seteado → id del nodo padre bajo el que anidar la tarea en ClickUp.
   */
  clickupParentId: v.optional(v.string()),
  /** List de ClickUp del destino (para reconstruir el selector al editar). */
  clickupListId: v.optional(v.string()),
  // ===== Capa agente (solo con executor=zcode; CONTRATO_AGENTE.md) =====
  taskType: v.optional(
    v.union(
      v.literal("reporte"),
      v.literal("desarrollo"),
      v.literal("analisis"),
      v.literal("ops"),
      v.literal("otro"),
    ),
  ),
  workspaceId: v.optional(v.id("agentWorkspaces")),
  workspacePath: v.optional(v.string()),
  autonomy: v.optional(
    v.union(
      v.literal("escenario"),
      v.literal("supervisado"),
      v.literal("autonomo"),
    ),
  ),
  model: v.optional(v.string()),
  notifyWhatsapp: v.optional(
    v.union(v.literal("off"), v.literal("final"), v.literal("periodica")),
  ),
};

/** Crea una nueva tarea. `order` se asigna al INICIO (order 0) de su estado. */
export const create = mutation({
  args: { ...taskFields, clickupLocal: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.sessionToken);
    // Separación Git/archivos (CONTRATO_AGENTE.md §4) ya en el alta.
    if (args.executor === "zcode") {
      await validateDelegation(ctx, {
        taskType: args.taskType,
        workspaceId: args.workspaceId,
      });
    }
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
      superUrgent: args.superUrgent,
      clickupParentId: args.clickupParentId,
      clickupListId: args.clickupListId,
      clickupLocal: args.clickupLocal,
      // Capa agente: al asignar a ZCode la tarea nace encolada para el puente.
      taskType: args.executor === "zcode" ? args.taskType : undefined,
      workspaceId: args.executor === "zcode" ? args.workspaceId : undefined,
      workspacePath:
        args.executor === "zcode" && args.workspaceId
          ? (args.workspacePath ?? undefined)
          : undefined,
      autonomy: args.executor === "zcode" ? args.autonomy : undefined,
      model: args.executor === "zcode" ? args.model : undefined,
      notifyWhatsapp: args.executor === "zcode" ? args.notifyWhatsapp : undefined,
      agentState: args.executor === "zcode" ? "encolada" : undefined,
      order: 0,
      completedAt: args.status === "completado" ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });

    // ===== Bitácora: la tarea nació =====
    await logEvent(ctx, {
      taskId,
      kind: "created",
      task: { title: sanitized.title ?? args.title, area: args.area },
      at: now,
      toStatus: args.status,
    });
    // Crear una tarea ya completada (registrar algo hecho a posteriori) cuenta
    // como completada esa semana, no solo como creada.
    if (args.status === "completado") {
      await logEvent(ctx, {
        taskId,
        kind: "completed",
        task: { title: sanitized.title ?? args.title, area: args.area },
        at: now,
        toStatus: "completado",
      });
    }

    // ===== Sync ClickUp outbound (solo patagonia, no local) =====
    // El handler del scheduler valida enabled/área internamente; agendamos
    // sin más para que corra en background sin bloquear el retorno.
    // Las tareas "solo local" nunca se crean en ClickUp.
    if (args.area === "patagonia" && !args.clickupLocal) {
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
      v.union(v.literal("cris"), v.literal("claw"), v.literal("zcode")),
    ),
    estimate: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    progress: v.optional(v.number()),
    standbyFrom: v.optional(v.string()),
    standbyUntil: v.optional(v.string()),
    scheduledDates: v.optional(v.string()),
    requestedBy: v.optional(v.string()),
    superUrgent: v.optional(v.boolean()),
    clickupParentId: v.optional(v.string()),
    clickupListId: v.optional(v.string()),
    clickupLocal: v.optional(v.boolean()),
    // ===== Capa agente (solo con executor=zcode) =====
    taskType: v.optional(
      v.union(
        v.literal("reporte"),
        v.literal("desarrollo"),
        v.literal("analisis"),
        v.literal("ops"),
        v.literal("otro"),
      ),
    ),
    workspaceId: v.optional(v.id("agentWorkspaces")),
    /** "" explícito = quitar la carpeta asignada. */
    workspacePath: v.optional(v.string()),
    autonomy: v.optional(
      v.union(
        v.literal("escenario"),
        v.literal("supervisado"),
        v.literal("autonomo"),
      ),
    ),
    model: v.optional(v.string()),
    notifyWhatsapp: v.optional(
      v.union(v.literal("off"), v.literal("final"), v.literal("periodica")),
    ),
  },
  handler: async (ctx, { sessionToken, id, ...patch }) => {
    await requireAuth(ctx, sessionToken);
    const task = await ctx.db.get(id);
    if (!task || task.deletedAt !== undefined)
      throw new Error("Tarea no encontrada");
    const now = Date.now();

    // ===== Capa agente: coherencia de la delegación al editar =====
    // El executor final decide si la tarea queda delegada; el vaciado de
    // carpeta (workspacePath="") se normaliza ANTES como el resto de strings.
    if (patch.workspacePath === "") patch.workspacePath = undefined;
    const asPatch = patch as Record<string, unknown>;
    const nextExecutor = patch.executor ?? task.executor;
    const delegating = nextExecutor === "zcode";
    if (delegating) {
      const nextType = patch.taskType ?? task.taskType;
      const nextWs = patch.workspaceId !== undefined ? patch.workspaceId : task.workspaceId;
      await validateDelegation(ctx, { taskType: nextType, workspaceId: nextWs });
      // Asignación nueva (o re-delegación tras cancelar): vuelve a la cola.
      if (task.agentState === undefined || task.agentState === "cancelada") {
        asPatch.agentState = "encolada";
      }
    } else if (task.agentState !== undefined && patch.executor !== undefined) {
      // Se quitó a ZCode como ejecutor: la capa agente se apaga.
      asPatch.agentState = undefined;
      asPatch.agentQuestion = undefined;
      asPatch.agentFollowUp = undefined;
    }

    // Sanea textos y clamp del progreso antes de aplicarlos.
    const sanitized = sanitizeTaskText(patch);
    if (sanitized.title !== undefined) patch.title = sanitized.title;
    if (sanitized.notes !== undefined) patch.notes = sanitized.notes;
    if (sanitized.requestedBy !== undefined)
      patch.requestedBy = sanitized.requestedBy;
    if (patch.progress !== undefined) patch.progress = clampProgress(patch.progress);

    // Campos de texto opcional (fechas, estimación, standby, etc.): un string
    // vacío explícito significa "vaciar el campo". Lo persistimos como
    // undefined para que desaparezca, en vez de ignorarlo. Esto permite limpiar
    // una fecha al editar (el DatePicker emite "" al limpiar).
    // Destino ClickUp: el cliente manda "" para decir "sin destino" (limpiar).
    // Es la ÚNICA forma de distinguir "no toqué el destino" (campo ausente,
    // llega como undefined) de "lo vacié": Convex descarta los undefined al
    // serializar, así que un undefined explícito es indistinguible de omitirlo.
    // Por eso calculamos el cambio ANTES de normalizar "" → undefined.
    const destTouched =
      patch.clickupParentId !== undefined || patch.clickupListId !== undefined;
    const nextParentId = patch.clickupParentId
      ? patch.clickupParentId
      : undefined;
    const nextListId = patch.clickupListId ? patch.clickupListId : undefined;

    for (const f of [
      "dueDate",
      "estimate",
      "standbyFrom",
      "standbyUntil",
      "scheduledDates",
      "notes",
      "requestedBy",
      "clickupParentId",
      "clickupListId",
    ] as const) {
      if ((patch as Record<string, unknown>)[f] === "") {
        (patch as Record<string, unknown>)[f] = undefined;
      }
    }

    // Separar el cambio de estado del resto del patch.
    const { status: newStatus, ...restPatch } = patch;

    // Si cambia el destino ClickUp y la tarea ya estaba sincronizada, la
    // desvinculamos para que el próximo sync la recree en el nuevo destino.
    // El handler de sync con op="update" detecta que no tiene clickupId y la
    // crea en el destino correcto. La tarea vieja en ClickUp queda huérfana
    // (no se borra) salvo que el cambio venga de un move explícito.
    //
    // Ojo: contemplamos también el cambio SOLO de list (tarea plana que se
    // mueve de proyecto sin parent) y el vaciado del parent → Mesa Técnica.
    //
    // Activar "solo local" en una tarea ya sincronizada también desvincula:
    // la copia en ClickUp queda (no se borra), pero deja de sincronizarse.
    const goingLocal = patch.clickupLocal === true;
    if (
      task.clickupId &&
      (goingLocal ||
        (destTouched &&
          (nextParentId !== task.clickupParentId ||
            nextListId !== task.clickupListId)))
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
        // Completar desde el modal también implica 100%, salvo que el propio
        // patch traiga un progreso explícito.
        if (restPatch.progress === undefined) extra.progress = 100;
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
        // Mismo criterio que al arrastrar o usar el botón rápido: completada
        // implica 100%, salvo que el propio patch traiga otro progreso.
        if (patch.progress === undefined) next.progress = 100;
      }
      if (patch.status && patch.status !== "completado") {
        next.completedAt = undefined;
      }
      await ctx.db.patch(id, next);
    }

    // ===== Bitácora =====
    // Se registra con el título/área NUEVOS (los que quedaron tras el patch),
    // porque es así como vas a reconocer la tarea al leer el catch-up.
    const snapshot = {
      title: patch.title ?? task.title,
      area: patch.area ?? task.area,
    };
    if (newStatus && newStatus !== task.status) {
      await logStatusChange(ctx, {
        taskId: id,
        task: snapshot,
        from: task.status,
        to: newStatus,
        at: now,
      });
    }
    // El progreso solo se registra si se movió de verdad. Guardar un evento
    // por cada guardado del modal llenaría la semana de ruido sin contenido.
    if (patch.progress !== undefined && patch.progress !== task.progress) {
      await logEvent(ctx, {
        taskId: id,
        kind: "progress",
        task: snapshot,
        at: now,
        fromProgress: task.progress,
        toProgress: patch.progress,
      });
    }

    // ===== Sync ClickUp outbound (solo patagonia, no local) =====
    // El área final puede haber cambiado: releemos para decidir.
    const updated = await ctx.db.get(id);
    if (updated && updated.area === "patagonia" && !updated.clickupLocal) {
      await ctx.scheduler.runAfter(0, internal.clickup.syncTask, {
        sessionToken,
        taskId: id,
        op: syncOp ?? "update",
      });
    } else if (updated && updated.clickupId) {
      // Salió de patagonia (o quedó "solo local") estando sincronizada:
      // desvincular sin borrar en ClickUp.
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

    // ===== Bitácora =====
    // El evento sobrevive a la tarea: si la borraste el jueves, el catch-up
    // igual puede contar que existió y qué pasó con ella esa semana.
    await logEvent(ctx, {
      taskId: id,
      kind: "deleted",
      task,
      at: now,
      fromStatus: task.status,
    });

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
            // La fecha de completado NO se pisa si ya existe: es el dato de
            // "cuándo se terminó esto", no "cuándo la toqué por última vez".
            // Antes se reescribía con `now` en cada movimiento hacia la
            // columna, y el "completado hace..." saltaba a hoy.
            completedAt:
              newStatus === "completado" ? (task.completedAt ?? now) : undefined,
            // Completar es completar, venga de donde venga: arrastrar a la
            // columna dejaba el progreso como estaba y quedaban tareas
            // completadas mostrando 40%. Solo `toggleComplete` lo forzaba.
            ...(newStatus === "completado" ? { progress: 100 } : {}),
          }),
        );
      } else {
        updates.push(
          ctx.db.patch(t._id, { order: i, updatedAt: now }),
        );
      }
    });
    await Promise.all(updates);

    // ===== Bitácora: arrastrar una tarjeta también es trabajo =====
    await logStatusChange(ctx, {
      taskId: id,
      task,
      from: oldStatus,
      to: newStatus,
      at: now,
    });

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
      // Se conserva la fecha original si ya estaba completada (ver changeStatus).
      completedAt: completing ? (task.completedAt ?? now) : undefined,
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

    // ===== Bitácora =====
    // Ojo: NO se registra un evento por cada sub-tarea del arrastre de arriba.
    // Cerrar la tarea madre ya cuenta la historia; una tarea con 8 sub-tareas
    // ahogaría el resumen de la semana en ruido y haría parecer que hiciste
    // ocho cosas cuando hiciste una.
    await logStatusChange(ctx, {
      taskId: id,
      task,
      from: oldStatus,
      to: newStatus,
      at: now,
    });

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

/**
 * Desvincula una tarea de ClickUp: sigue en el tablero, pero deja de
 * sincronizarse en ambos sentidos y borrarla acá ya NO la borra en ClickUp.
 *
 * Es una operación puramente local: no se manda absolutamente nada a ClickUp.
 * Allá la tarea queda intacta.
 *
 * Se conserva el `clickupId` a propósito (ver el comentario en el schema): si
 * se limpiara, la siguiente edición haría que el sync la tomara por nueva y
 * CREARA una tarea duplicada en ClickUp, y el escaneo inbound la volvería a
 * ofrecer para reimportar.
 */
export const detachFromClickup = mutation({
  args: { ...sessionArg, id: v.id("tasks") },
  handler: async (ctx, { sessionToken, id }) => {
    await requireAuth(ctx, sessionToken);
    const task = await ctx.db.get(id);
    if (!task || task.deletedAt !== undefined)
      throw new Error("Tarea no encontrada");
    if (!task.clickupId) throw new Error("La tarea no está vinculada a ClickUp");
    await ctx.db.patch(id, {
      clickupDetached: true,
      clickupSyncError: undefined,
      updatedAt: Date.now(),
    });
    return id;
  },
});

/**
 * Pin "llevar al catch-up": marca o desmarca una tarea como tema a conversar
 * con la jefatura, con una nota corta opcional.
 *
 * Existe para resolver el problema real: el martes a las 9 no te acordás de
 * por qué el jueves anterior algo se trabó. Lo marcás en el momento, con el
 * contexto fresco, y aparece solo en el bloque "Temas para conversar".
 *
 * El pin NO es un estado de la tarea ni toca ClickUp: es una anotación tuya
 * para tu reunión.
 */
export const toggleCatchupFlag = mutation({
  args: {
    ...sessionArg,
    id: v.id("tasks"),
    /** Si se omite, alterna el valor actual. */
    flagged: v.optional(v.boolean()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { sessionToken, id, flagged, note }) => {
    await requireAuth(ctx, sessionToken);
    const task = await ctx.db.get(id);
    if (!task || task.deletedAt !== undefined)
      throw new Error("Tarea no encontrada");
    const now = Date.now();
    const next = flagged ?? !task.catchupFlag;

    await ctx.db.patch(id, {
      catchupFlag: next,
      // Al desmarcar se limpia la nota: dejarla colgando haría que reaparezca
      // con un texto viejo la próxima vez que marques la misma tarea.
      catchupNote: next ? note?.slice(0, TEXT_MAX * 3) : undefined,
      catchupFlaggedAt: next ? (task.catchupFlaggedAt ?? now) : undefined,
      updatedAt: now,
    });

    if (next) {
      await logEvent(ctx, {
        taskId: id,
        kind: "flagged",
        task,
        at: now,
        detail: note,
      });
    }
    return id;
  },
});
