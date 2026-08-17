import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import {
  SETTINGS_KEY_LAST_SYNC,
  SETTINGS_KEY_LAST_INBOUND,
  type HermesStatus,
} from "./clickupConfig";
import { logEvent, logStatusChange } from "./events";

/**
 * Mutaciones internas para la integración ClickUp.
 *
 * Viven en un archivo SIN `"use node"` porque las mutations de Convex corren
 * en el runtime V8 (no Node). Solo las `action` pueden usar Node (ver clickup.ts).
 * Se invocan desde `clickup.ts` vía `ctx.runMutation(internal.clickupMutations.X)`.
 */

/** Marca una tarea como sincronizada OK. */
export const _markSynced = internalMutation({
  args: {
    taskId: v.id("tasks"),
    clickupId: v.string(),
    clickupUrl: v.string(),
    clickupListId: v.optional(v.string()),
  },
  handler: async (ctx, { taskId, clickupId, clickupUrl, clickupListId }) => {
    await ctx.db.patch(taskId, {
      clickupId,
      clickupUrl,
      clickupSyncedAt: Date.now(),
      clickupSyncError: undefined,
      ...(clickupListId !== undefined ? { clickupListId } : {}),
    });
  },
});

/** Marca el último error de sync en una tarea. */
export const _markSyncError = internalMutation({
  args: { taskId: v.id("tasks"), error: v.string() },
  handler: async (ctx, { taskId, error }) => {
    await ctx.db.patch(taskId, {
      clickupSyncError: error.slice(0, 500),
      clickupSyncedAt: Date.now(),
    });
  },
});

/** Desvincula una tarea de ClickUp (limpia clickupId, sin borrar en ClickUp). */
export const _unlinkClickUp = internalMutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    await ctx.db.patch(taskId, {
      clickupId: undefined,
      clickupUrl: undefined,
      clickupSyncedAt: Date.now(),
      clickupSyncError: undefined,
    });
  },
});

/** Registra el timestamp del último sync outbound (en settings). */
export const _touchLastSync = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_LAST_SYNC))
      .first();
    if (row) {
      await ctx.db.patch(row._id, { value: String(now), updatedAt: now });
    } else {
      await ctx.db.insert("settings", {
        key: SETTINGS_KEY_LAST_SYNC,
        value: String(now),
        updatedAt: now,
      });
    }
  },
});

// ============================================================
//  INBOUND (ClickUp → Hermes) — mutations de soporte
// ============================================================

/** Registra el timestamp del último escaneo inbound (en settings). */
export const _touchLastInbound = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_LAST_INBOUND))
      .first();
    if (row) {
      await ctx.db.patch(row._id, { value: String(now), updatedAt: now });
    } else {
      await ctx.db.insert("settings", {
        key: SETTINGS_KEY_LAST_INBOUND,
        value: String(now),
        updatedAt: now,
      });
    }
  },
});

/**
 * Query interna: trae las tareas mapeadas (con clickupId) y los clickupIds
 * marcados como ignorados, para que fetchInboundDiff pueda cruzar contra
 * ClickUp sin re-scannear la DB completa.
 */
export const _listMappedForInbound = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("tasks").collect();
    // Para el chequeo de "ya existe" en applySubscriptions, incluimos TODAS las
    // tareas con clickupId (incluso borradas/ignoradas) para evitar duplicados
    // al re-suscribirse. El campo `ignored` se reporta aparte para el inbound diff.
    const mapped = all
      .filter(
        (t) =>
          t.clickupId !== undefined &&
          t.deletedAt === undefined &&
          !t.clickupInboundIgnored &&
          // Las desvinculadas no participan del sync: tampoco reciben cambios
          // de estado inbound. Siguen en `allEntries` para que el escaneo no
          // las ofrezca como nuevas.
          !t.clickupDetached,
      )
      .map((t) => ({
        taskId: t._id,
        clickupId: t.clickupId as string,
        status: t.status as HermesStatus,
      }));
    const ignoredClickupIds = all
      .filter((t) => t.clickupInboundIgnored && t.clickupId)
      .map((t) => t.clickupId as string);
    // TODAS las tareas con clickupId (incluyendo borradas/ignoradas) para
    // anti-duplicado al importar y restauración al re-suscribirse. Array de
    // objetos planos (Convex no soporta Map como tipo de retorno).
    const allEntries = all
      .filter((t) => t.clickupId !== undefined)
      .map((t) => ({
        clickupId: t.clickupId as string,
        taskId: t._id,
        deleted: t.deletedAt !== undefined,
        ignored: t.clickupInboundIgnored === true,
      }));
    return { mapped, ignoredClickupIds, allEntries };
  },
});

/**
 * Crea una tarea nueva en Hermes a partir de una tarea de ClickUp aprobada en
 * el modal de sync reversa. Área siempre patagonia.
 */
export const _createInboundTask = internalMutation({
  args: {
    title: v.string(),
    clickupId: v.string(),
    clickupParentId: v.optional(v.string()),
    status: v.string(),
    dueDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    timeEstimateMs: v.optional(v.number()),
    isAssignedToCris: v.optional(v.boolean()),
    assigneeName: v.optional(v.string()),
    /** Ubicación en ClickUp (folder/list/ancestros) para agrupar el tablero. */
    clickupPath: v.optional(
      v.object({
        folderName: v.optional(v.string()),
        listName: v.optional(v.string()),
        listId: v.optional(v.string()),
        folderId: v.optional(v.string()),
        ancestors: v.optional(v.array(v.string())),
        resolvedAt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Idempotencia: una tarea de ClickUp no puede entrar dos veces al tablero.
    // Sin este chequeo se creaban tarjetas duplicadas (dos "Ley 21.719"), y
    // como desuscribirse resolvía por clickupId, quedaba una viva para
    // siempre. Si ya existe activa, no se hace nada; si está borrada o
    // ignorada, se restaura en vez de duplicarla.
    const existing = await ctx.db
      .query("tasks")
      .withIndex("by_clickup_id", (q) => q.eq("clickupId", args.clickupId))
      .collect();
    const alive = existing.find((t) => t.deletedAt === undefined);
    if (alive) return alive._id;
    if (existing.length > 0) {
      const revived = existing[0];
      await ctx.db.patch(revived._id, {
        deletedAt: undefined,
        clickupInboundIgnored: undefined,
        updatedAt: now,
      });
      return revived._id;
    }

    // Insertar al inicio (order 0) de la columna destino, desplazando +1.
    const col = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", args.status as HermesStatus))
      .collect();
    const active = col.filter((t) => t.deletedAt === undefined);
    await Promise.all(
      active
        .sort((a, b) => a.order - b.order)
        .map((t, i) => ctx.db.patch(t._id, { order: i + 1, updatedAt: now })),
    );

    // Convertir time_estimate (ms) a texto legible para el campo estimate.
    let estimate: string | undefined;
    if (args.timeEstimateMs && args.timeEstimateMs > 0) {
      const hours = args.timeEstimateMs / 3600000;
      estimate = Number.isInteger(hours)
        ? `${hours}h`
        : `${Math.round(hours * 10) / 10}h`;
    }

    const taskId = await ctx.db.insert("tasks", {
      title: args.title.slice(0, 200),
      area: "patagonia",
      status: args.status as HermesStatus,
      notes: args.notes?.slice(0, 5000) || undefined,
      estimate,
      dueDate: args.dueDate,
      clickupId: args.clickupId,
      clickupParentId: args.clickupParentId,
      clickupUrl: `https://app.clickup.com/t/${args.clickupId}`,
      clickupSyncedAt: now,
      clickupPath: args.clickupPath,
      // Preservar el responsable original de ClickUp. Si eres tú → executor=cris.
      // Si es otro → guardamos su nombre en clickupAssignee y dejamos executor
      // sin setear (no forzamos "claw" que es el agente Hermes, no la persona real).
      clickupAssignee: args.assigneeName,
      executor: args.isAssignedToCris ? "cris" : undefined,
      order: 0,
      completedAt: args.status === "completado" ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });

    // ===== Bitácora =====
    // Las tareas importadas alimentan el bloque "Entró esta semana", que es
    // lo que justifica por qué no avanzó lo planificado.
    await logEvent(ctx, {
      taskId,
      kind: "created",
      task: { title: args.title.slice(0, 200), area: "patagonia" },
      at: now,
      toStatus: args.status,
      viaClickup: true,
    });
    return taskId;
  },
});

/** Aplica un cambio de estado inbound a una tarea existente (mantiene order). */
export const _applyInboundStatus = internalMutation({
  args: {
    taskId: v.id("tasks"),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const task = await ctx.db.get(args.taskId);
    if (!task || task.deletedAt !== undefined) return;
    await ctx.db.patch(args.taskId, {
      status: args.status as HermesStatus,
      clickupSyncedAt: now,
      clickupSyncError: undefined,
      // No pisar la fecha de completado si la tarea ya la tenía: cada sync
      // desde ClickUp la estaba reescribiendo con la hora del sync, así que
      // el "completado hace..." se reseteaba solo.
      completedAt:
        args.status === "completado" ? (task.completedAt ?? now) : undefined,
      updatedAt: now,
    });

    // ===== Bitácora =====
    // Un cambio aprobado desde el modal de sync inbound es trabajo tuyo igual
    // (vos lo aprobaste), pero se marca `viaClickup` para poder distinguirlo:
    // si algo se completó porque otra persona lo cerró en ClickUp, no es lo
    // mismo que si lo cerraste vos, y el catch-up debe poder notarlo.
    await logStatusChange(ctx, {
      taskId: args.taskId,
      task,
      from: task.status,
      to: args.status,
      at: now,
      viaClickup: true,
    });
  },
});

/**
 * Restaura una tarea soft-deleted/ignorada al re-suscribirse: quita deletedAt
 * y clickupInboundIgnored para que vuelva a aparecer en el tablero y en la
 * página de sync.
 */
export const _restoreInboundTask = internalMutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const now = Date.now();
    await ctx.db.patch(taskId, {
      deletedAt: undefined,
      clickupInboundIgnored: undefined,
      updatedAt: now,
    });
  },
});

/**
 * Actualiza el responsable de una tarea (executor + clickupAssignee).
 *
 * `preserveExistingExecutor` protege la elección manual del usuario: `executor`
 * (Cris / Claw) es un campo de Hermes, distinto del responsable real en
 * ClickUp (`clickupAssignee`). Con el flag activo, solo se rellena si está
 * vacío. Sin él, un `undefined` acá BORRA el campo — que es exactamente lo que
 * hacía la re-sincronización masiva de responsables sobre todas las tareas.
 */
export const _updateAssignee = internalMutation({
  args: {
    taskId: v.id("tasks"),
    executor: v.optional(v.string()),
    clickupAssignee: v.optional(v.string()),
    preserveExistingExecutor: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { taskId, executor, clickupAssignee, preserveExistingExecutor },
  ) => {
    const now = Date.now();
    const patch: Record<string, unknown> = {
      clickupAssignee,
      updatedAt: now,
    };
    if (preserveExistingExecutor) {
      const task = await ctx.db.get(taskId);
      // Solo completar si no había nada elegido.
      if (!task?.executor && executor) patch.executor = executor;
    } else {
      patch.executor = executor;
    }
    await ctx.db.patch(taskId, patch);
  },
});

/**
 * Marca una tarea (por clickupId) como ignorada para inbound, evitando que
 * reaparezca como "nueva" en futuros escaneos. Se invoca desde "Ignorar" en el
 * modal. Si no existe tarea con ese clickupId, crea un stub marcado.
 */
export const _ignoreInbound = internalMutation({
  args: { clickupId: v.string() },
  handler: async (ctx, { clickupId }) => {
    // TODAS las tareas con ese clickupId, no solo la primera: si la misma
    // tarea de ClickUp se importó dos veces (algo que hasta ahora no se
    // impedía), `.first()` desuscribía una y dejaba la otra viva en el
    // tablero — decía "listo" y la tarjeta seguía ahí.
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_clickup_id", (q) => q.eq("clickupId", clickupId))
      .collect();
    const now = Date.now();
    if (tasks.length > 0) {
      for (const task of tasks) {
        // Soft-delete: la tarea desaparece del tablero y de la página de sync.
        // Se marca como ignorada para que no reaparezca en futuros escaneos.
        // NO se toca nada en ClickUp.
        await ctx.db.patch(task._id, {
          clickupInboundIgnored: true,
          deletedAt: task.deletedAt ?? now,
          updatedAt: now,
        });
      }
      return { affected: tasks.length };
    }
    {
      // No existe tarea con ese clickupId: crear un stub ignorado para que no
      // reaparezca. Área patagonia, soft-deleted para no mostrarlo en la UI.
      const now = Date.now();
      await ctx.db.insert("tasks", {
        title: "(ignorada de ClickUp)",
        area: "patagonia",
        status: "pendiente",
        clickupId,
        clickupInboundIgnored: true,
        deletedAt: now,
        order: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

/**
 * Revierte un alta reciente hecha desde la bandeja de asignadas: BORRA de
 * verdad las tareas recién importadas (y sus subtareas), en vez de marcarlas
 * como ignoradas.
 *
 * El soft-delete de `_ignoreInbound` no sirve como "deshacer": deja la tarea
 * marcada como descartada, así que nunca volvería a aparecer en la bandeja.
 * Deshacer tiene que dejar todo como si el alta no hubiera pasado, incluida la
 * posibilidad de volver a agregarla.
 *
 * Guarda de seguridad: solo borra tareas creadas hace menos de MAX_AGE_MS. Un
 * "deshacer" tardío (pestaña vieja, doble click a destiempo) no puede destruir
 * una tarea con trabajo encima.
 */
export const _undoInboundAdd = internalMutation({
  args: { clickupIds: v.array(v.string()) },
  handler: async (ctx, { clickupIds }) => {
    const MAX_AGE_MS = 15 * 60 * 1000;
    const now = Date.now();
    let removed = 0;
    let skipped = 0;
    for (const clickupId of clickupIds) {
      const task = await ctx.db
        .query("tasks")
        .withIndex("by_clickup_id", (q) => q.eq("clickupId", clickupId))
        .first();
      if (!task) continue;
      if (now - task.createdAt > MAX_AGE_MS) {
        skipped++;
        continue;
      }
      // Borrar primero las subtareas: si no, quedarían huérfanas apuntando a
      // una tarea inexistente.
      const subs = await ctx.db
        .query("subtasks")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .collect();
      for (const s of subs) await ctx.db.delete(s._id);
      await ctx.db.delete(task._id);
      removed++;
    }
    return { removed, skipped };
  },
});

/** Tareas sincronizadas a las que les falta la ruta de ClickUp resuelta. */
export const _listTasksNeedingPath = internalQuery({
  args: { onlyMissing: v.boolean() },
  handler: async (ctx, { onlyMissing }) => {
    const all = await ctx.db.query("tasks").collect();
    return all
      .filter(
        (t) =>
          t.clickupId !== undefined &&
          t.deletedAt === undefined &&
          // Sin ruta, o con ruta a medias (folder/list pero sin ancestros
          // resueltos, que es lo que deja el alta rápida desde la bandeja).
          (!onlyMissing ||
            !t.clickupPath ||
            t.clickupPath.ancestors === undefined),
      )
      .map((t) => ({ taskId: t._id, clickupId: t.clickupId as string }));
  },
});

/** Guarda la ruta resuelta de una tarea. */
export const _setClickupPath = internalMutation({
  args: {
    taskId: v.id("tasks"),
    clickupPath: v.object({
      folderName: v.optional(v.string()),
      listName: v.optional(v.string()),
      listId: v.optional(v.string()),
      folderId: v.optional(v.string()),
      ancestors: v.optional(v.array(v.string())),
      resolvedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { taskId, clickupPath }) => {
    await ctx.db.patch(taskId, { clickupPath });
  },
});

/**
 * Busca tareas activas que compartan clickupId (la misma tarea de ClickUp
 * importada más de una vez) y deja una sola.
 *
 * Se conserva la MÁS VIEJA, que es la que probablemente tiene tu trabajo
 * encima (notas, progreso, subtareas); las copias se soft-deletean, así que
 * son recuperables desde la base si algo sale mal. No se toca ClickUp.
 *
 * `dryRun` solo cuenta, sin modificar nada.
 */
export const _dedupeClickupTasks = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    const all = await ctx.db.query("tasks").collect();
    const byClickupId = new Map<string, typeof all>();
    for (const t of all) {
      if (!t.clickupId || t.deletedAt !== undefined) continue;
      const arr = byClickupId.get(t.clickupId) ?? [];
      arr.push(t);
      byClickupId.set(t.clickupId, arr);
    }

    const now = Date.now();
    let groups = 0;
    let removed = 0;
    const detail: { clickupId: string; title: string; copies: number }[] = [];

    for (const [clickupId, tasks] of byClickupId) {
      if (tasks.length < 2) continue;
      groups++;
      detail.push({
        clickupId,
        title: tasks[0].title,
        copies: tasks.length,
      });
      const sorted = [...tasks].sort((a, b) => a.createdAt - b.createdAt);
      // sorted[0] se queda; el resto se retira del tablero.
      for (const dup of sorted.slice(1)) {
        removed++;
        if (!dryRun) {
          await ctx.db.patch(dup._id, { deletedAt: now, updatedAt: now });
        }
      }
    }
    return { groups, removed, detail: detail.slice(0, 20) };
  },
});
