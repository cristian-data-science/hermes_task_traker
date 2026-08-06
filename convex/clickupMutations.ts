import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import {
  SETTINGS_KEY_LAST_SYNC,
  SETTINGS_KEY_LAST_INBOUND,
  type HermesStatus,
} from "./clickupConfig";

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
          !t.clickupInboundIgnored,
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
  },
  handler: async (ctx, args) => {
    const now = Date.now();
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
      // Preservar el responsable original de ClickUp. Si sos vos → executor=cris.
      // Si es otro → guardamos su nombre en clickupAssignee y dejamos executor
      // sin setear (no forzamos "claw" que es el agente Hermes, no la persona real).
      clickupAssignee: args.assigneeName,
      executor: args.isAssignedToCris ? "cris" : undefined,
      order: 0,
      completedAt: args.status === "completado" ? now : undefined,
      createdAt: now,
      updatedAt: now,
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
      completedAt: args.status === "completado" ? now : undefined,
      updatedAt: now,
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

/** Actualiza el responsable de una tarea (executor + clickupAssignee). */
export const _updateAssignee = internalMutation({
  args: {
    taskId: v.id("tasks"),
    executor: v.optional(v.string()),
    clickupAssignee: v.optional(v.string()),
  },
  handler: async (ctx, { taskId, executor, clickupAssignee }) => {
    const now = Date.now();
    await ctx.db.patch(taskId, {
      executor: executor as "cris" | "claw" | undefined,
      clickupAssignee,
      updatedAt: now,
    });
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
    const task = await ctx.db
      .query("tasks")
      .withIndex("by_clickup_id", (q) => q.eq("clickupId", clickupId))
      .first();
    if (task) {
      // Soft-delete: la tarea desaparece del tablero y de la página de sync.
      // Se marca como ignorada para que no reaparezca en futuros escaneos.
      const now = Date.now();
      await ctx.db.patch(task._id, {
        clickupInboundIgnored: true,
        deletedAt: now,
        updatedAt: now,
      });
    } else {
      // No existe tarea con ese clickupId: crear un stub ignorado para que no
      // reaparezca. Área patagonia, soft-deleted para no mostrarlo en la UI.
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
