/**
 * Panel Hoy — imprevistos: el registro del trabajo NO trackeado.
 *
 * ===== LA IDEA =====
 * Un imprevisto es lo que surge en el día y no está anotado en el tablero.
 * Vive en esta tabla propia (NO en `tasks`) para no contaminar Kanban, list,
 * calendario, catch-up ni inbound. La métrica que justifica su existencia:
 * cuántos surgen por día, cuántos se resuelven el mismo día y cuántos quedan
 * abiertos comiéndose el recurso de lo planificado.
 *
 * ===== CICLO DE VIDA =====
 *   abierto → resuelto (check)          → resolvedAt, open=false
 *   abierto → promovido (a task real)   → promotedAt + promotedTaskId
 *   cualquiera → borrado (soft)         → deletedAt (y su subtask de ClickUp
 *                                         se borra para no dejar basura)
 *
 * ===== SYNC CLICKUP =====
 * Cada imprevisto se refleja como SUBTAREA del padre "Imprevistos Cris"
 * (Mesa Técnica). El sync vive en imprevistosSync.ts (runtime Node) y es
 * best-effort: si ClickUp está off o falla, el imprevisto funciona 100%
 * local y el error queda en la fila para reintentar en el próximo sweep.
 */

import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { v } from "convex/values";
import { requireAuth } from "./authGuard";
import { internal } from "./_generated/api";
import { logEvent } from "./events";

const sessionArg = { sessionToken: v.string() };

/** Límite del título (anti-abuso de almacenamiento, igual que tasks). */
const TITLE_MAX = 200;

function sanitizeTitle(title: string): string {
  return title.trim().slice(0, TITLE_MAX);
}

// ============================================================
//  QUERIES (lectura)
// ============================================================

/** Los imprevistos de un día (activos), ordenados por su posición en el panel. */
export const byDay = query({
  args: { ...sessionArg, day: v.number() },
  handler: async (ctx, { sessionToken, day }) => {
    await requireAuth(ctx, sessionToken);
    const rows = await ctx.db
      .query("imprevistos")
      .withIndex("by_day", (q) => q.eq("day", day))
      .order("asc")
      .collect();
    return rows.filter((r) => r.deletedAt === undefined);
  },
});

/**
 * Imprevistos abiertos de días ANTERIORES a `day` (los "quedaron para otros
 * días"). Ordenados por día ascendente: los más viejos primero — lo que más
 * se arrastras arriba, para que incomode y se cierre.
 */
export const openBefore = query({
  args: { ...sessionArg, day: v.number() },
  handler: async (ctx, { sessionToken, day }) => {
    await requireAuth(ctx, sessionToken);
    const rows = await ctx.db
      .query("imprevistos")
      .withIndex("by_open", (q) => q.eq("open", true).lt("day", day))
      .order("asc")
      .collect();
    return rows;
  },
});

/**
 * Imprevistos del rango [from, to) por día de surgimiento (excluye borrados:
 * un imprevisto borrado "no existió"). Devuelve las filas crudas: la
 * agregación por día (mismo-día, tardíos, promovidos) la hace el cliente con
 * date-fns en hora local, que es la única que sabe dónde empieza cada día.
 */
export const statsRange = query({
  args: { ...sessionArg, from: v.number(), to: v.number() },
  handler: async (ctx, { sessionToken, from, to }) => {
    await requireAuth(ctx, sessionToken);
    const rows = await ctx.db
      .query("imprevistos")
      .withIndex("by_day", (q) => q.gte("day", from).lt("day", to))
      .order("asc")
      .collect();
    return rows
      .filter((r) => r.deletedAt === undefined)
      .map((r) => ({
        _id: r._id,
        title: r.title,
        day: r.day,
        open: r.open,
        resolvedAt: r.resolvedAt ?? null,
        promotedAt: r.promotedAt ?? null,
      }));
  },
});

// ============================================================
//  MUTATIONS (escritura)
// ============================================================

/**
 * Alta rápida: un título y nada más (la fricción mata la métrica — si cargar
 * un imprevisto cuesta más que un Enter, no se carga). Inserta ARRIBA (order
 * 0) y agenda el sync; el sweep que corre dentro también reintenta los
 * imprevistos anteriores que hubieran quedado pendientes de sync.
 */
export const create = mutation({
  args: { ...sessionArg, title: v.string(), day: v.number() },
  handler: async (ctx, { sessionToken, title, day }) => {
    await requireAuth(ctx, sessionToken);
    const clean = sanitizeTitle(title);
    if (!clean) throw new Error("El título del imprevisto no puede estar vacío");

    const now = Date.now();
    // Desplazar +1 los activos del día para dejar order 0 arriba.
    const dayRows = await ctx.db
      .query("imprevistos")
      .withIndex("by_day", (q) => q.eq("day", day))
      .collect();
    const active = dayRows
      .filter((r) => r.deletedAt === undefined)
      .sort((a, b) => a.order - b.order);
    await Promise.all(
      active.map((r, i) => ctx.db.patch(r._id, { order: i + 1, updatedAt: now })),
    );

    const id = await ctx.db.insert("imprevistos", {
      title: clean,
      day,
      order: 0,
      open: true,
      createdAt: now,
      updatedAt: now,
    });

    // El sweep procesa este imprevisto y reintenta los pendientes previos.
    await ctx.scheduler.runAfter(0, internal.imprevistosSync.sweepPending, {});
    return id;
  },
});

/** Marca el imprevisto como resuelto (el check del panel). */
export const resolve = mutation({
  args: { ...sessionArg, id: v.id("imprevistos") },
  handler: async (ctx, { sessionToken, id }) => {
    await requireAuth(ctx, sessionToken);
    const row = await ctx.db.get(id);
    if (!row || row.deletedAt !== undefined)
      throw new Error("El imprevisto no existe");
    if (row.promotedAt !== undefined)
      throw new Error("El imprevisto ya fue promovido a tarea");
    const now = Date.now();
    await ctx.db.patch(id, { resolvedAt: now, open: false, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.imprevistosSync.syncImprevisto, {
      imprevistoId: id,
    });
  },
});

/** Reabre un imprevisto resuelto (el uncheck). */
export const reopen = mutation({
  args: { ...sessionArg, id: v.id("imprevistos") },
  handler: async (ctx, { sessionToken, id }) => {
    await requireAuth(ctx, sessionToken);
    const row = await ctx.db.get(id);
    if (!row || row.deletedAt !== undefined)
      throw new Error("El imprevisto no existe");
    if (row.promotedAt !== undefined)
      throw new Error("El imprevisto ya fue promovido a tarea");
    const now = Date.now();
    await ctx.db.patch(id, {
      resolvedAt: undefined,
      open: true,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.imprevistosSync.syncImprevisto, {
      imprevistoId: id,
    });
  },
});

/** Reordena por lista completa de ids (igual que hoy.reorder). */
export const reorder = mutation({
  args: { ...sessionArg, ids: v.array(v.id("imprevistos")) },
  handler: async (ctx, { sessionToken, ids }) => {
    await requireAuth(ctx, sessionToken);
    const now = Date.now();
    await Promise.all(
      ids.map((id, i) => ctx.db.patch(id, { order: i, updatedAt: now })),
    );
  },
});

/**
 * Borra un imprevisto (borrado lógico; también se borra su subtask de
 * ClickUp para no dejar basura en Mesa Técnica). Un imprevisto borrado no
 * cuenta en las métricas: la semántica es "esto no debió cargarse".
 */
export const remove = mutation({
  args: { ...sessionArg, id: v.id("imprevistos") },
  handler: async (ctx, { sessionToken, id }) => {
    await requireAuth(ctx, sessionToken);
    const now = Date.now();
    await ctx.db.patch(id, { deletedAt: now, open: false, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.imprevistosSync.syncImprevisto, {
      imprevistoId: id,
    });
  },
});

/**
 * Promueve el imprevisto a tarea real del tablero. Marca el estado local YA
 * (métrica y panel al instante); la parte de ClickUp (sacar la subtask del
 * padre y crear la tarea Hermes enlazada) la completa async
 * imprevistosSync.promoteImprevisto. Si esa parte falla, el sweep la reintenta
 * (promovido sin promotedTaskId).
 */
export const promote = mutation({
  args: { ...sessionArg, id: v.id("imprevistos") },
  handler: async (ctx, { sessionToken, id }) => {
    await requireAuth(ctx, sessionToken);
    const row = await ctx.db.get(id);
    if (!row || row.deletedAt !== undefined)
      throw new Error("El imprevisto no existe");
    if (row.promotedAt !== undefined) return; // idempotente
    const now = Date.now();
    await ctx.db.patch(id, {
      promotedAt: now,
      open: false,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.imprevistosSync.promoteImprevisto, {
      imprevistoId: id,
    });
  },
});

// ============================================================
//  FUNCIONES INTERNAS (para imprevistosSync.ts, runtime Node)
// ============================================================

/** Lee un imprevisto crudo por id. Sin auth (uso desde actions). */
export const _getInternal = internalQuery({
  args: { imprevistoId: v.id("imprevistos") },
  handler: async (ctx, { imprevistoId }) => {
    const row = await ctx.db.get(imprevistoId);
    return row ?? null;
  },
});

/**
 * Imprevistos que necesitan atención del sync:
 *  1. Sin clickupSubtaskId, no borrados ni promovidos → crear la subtask
 *     (incluye los reintentos de errores previos).
 *  2. Promovidos sin promotedTaskId → la promoción quedó a medias (ClickUp
 *     falló a mitad de camino), reintentar.
 */
export const _pendingSync = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Tabla chica (uso unipersonal): el scan completo con filtro en memoria
    // es más simple que pelear con los índices por combinaciones de campos
    // opcionales (promotedAt/promotedTaskId no son indexables acá).
    const all = await ctx.db.query("imprevistos").collect();
    return all
      .filter(
        (r) =>
          r.deletedAt === undefined &&
          ((r.clickupSubtaskId === undefined && r.promotedAt === undefined) ||
            (r.promotedAt !== undefined && r.promotedTaskId === undefined)),
      )
      .slice(0, 50);
  },
});

/** Registra el sync exitoso de la subtask (y limpia error + claim). */
export const _markSynced = internalMutation({
  args: {
    imprevistoId: v.id("imprevistos"),
    clickupSubtaskId: v.string(),
    clickupUrl: v.optional(v.string()),
  },
  handler: async (ctx, { imprevistoId, clickupSubtaskId, clickupUrl }) => {
    const now = Date.now();
    await ctx.db.patch(imprevistoId, {
      clickupSubtaskId,
      clickupUrl: clickupUrl ?? `https://app.clickup.com/t/${clickupSubtaskId}`,
      clickupSyncError: undefined,
      clickupSyncClaim: undefined,
      clickupSyncedAt: now,
      updatedAt: now,
    });
  },
});

/** Registra el error de sync (visible en la fila; no bloquea nada local). */
export const _markSyncError = internalMutation({
  args: { imprevistoId: v.id("imprevistos"), error: v.string() },
  handler: async (ctx, { imprevistoId, error }) => {
    await ctx.db.patch(imprevistoId, {
      clickupSyncError: error.slice(0, 500),
      clickupSyncClaim: undefined,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Lock optimista para el sync de ClickUp: toma la fila si nadie la tiene
 * claim-eada (o el claim caducó). Devuelve false si otra corrida la tiene.
 * Las mutations Convex se serializan por documento, así el check+patch es
 * atómico: dos corridas no pueden ganar el mismo claim.
 */
export const _claimForSync = internalMutation({
  args: { imprevistoId: v.id("imprevistos"), ttlMs: v.optional(v.number()) },
  handler: async (ctx, { imprevistoId, ttlMs }) => {
    const row = await ctx.db.get(imprevistoId);
    if (!row) return false;
    const ttl = ttlMs ?? 120_000;
    if (
      row.clickupSyncClaim !== undefined &&
      Date.now() - row.clickupSyncClaim < ttl
    ) {
      return false;
    }
    await ctx.db.patch(imprevistoId, { clickupSyncClaim: Date.now() });
    return true;
  },
});

/**
 * Limpia la vinculación ClickUp de un imprevisto (tras borrar la subtask).
 * Deja el error por si hay que auditar, solo suelta los ids.
 */
export const _clearSync = internalMutation({
  args: { imprevistoId: v.id("imprevistos") },
  handler: async (ctx, { imprevistoId }) => {
    await ctx.db.patch(imprevistoId, {
      clickupSubtaskId: undefined,
      clickupUrl: undefined,
      clickupSyncedAt: undefined,
      clickupSyncClaim: undefined,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Completa la promoción: crea la tarea Hermes real enlazada a la tarea de
 * primer nivel de Mesa Técnica que dejó el sync, y ancla promotedTaskId.
 * Espeja la lógica de tasks.create (order 0 arriba + evento created) para
 * que la tarea nueva se comporte como cualquier otra del tablero.
 */
export const _finishPromotion = internalMutation({
  args: {
    imprevistoId: v.id("imprevistos"),
    clickupTaskId: v.string(),
    clickupUrl: v.optional(v.string()),
    /** Estado final de la tarea según el imprevisto al momento de promover. */
    status: v.union(v.literal("pendiente"), v.literal("completado")),
  },
  handler: async (ctx, { imprevistoId, clickupTaskId, clickupUrl, status }) => {
    const row = await ctx.db.get(imprevistoId);
    if (!row || row.promotedAt === undefined) return; // estado cambió a mitad
    if (row.promotedTaskId !== undefined) return; // idempotente

    const now = Date.now();
    // Desplazar +1 las pendientes para dejar order 0 arriba (como tasks.create).
    const pending = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", status))
      .collect();
    const sorted = pending
      .filter((t) => t.deletedAt === undefined)
      .sort((a, b) => a.order - b.order);
    await Promise.all(
      sorted.map((t, i) => ctx.db.patch(t._id, { order: i + 1, updatedAt: now })),
    );

    const taskId = await ctx.db.insert("tasks", {
      title: row.title,
      area: "patagonia",
      status,
      notes: `Promovido desde el panel Hoy (imprevisto del ${new Date(row.day).toLocaleDateString("es-CL")}).`,
      order: 0,
      completedAt: status === "completado" ? now : undefined,
      // Ya existe en ClickUp (la subtask promovida): nace sincronizada.
      clickupId: clickupTaskId,
      clickupUrl: clickupUrl ?? `https://app.clickup.com/t/${clickupTaskId}`,
      clickupListId: undefined,
      createdAt: now,
      updatedAt: now,
    });

    await logEvent(ctx, {
      taskId,
      kind: "created",
      task: { title: row.title, area: "patagonia" },
      at: now,
      toStatus: status,
    });

    await ctx.db.patch(imprevistoId, {
      promotedTaskId: taskId,
      clickupSubtaskId: clickupTaskId,
      clickupUrl: clickupUrl ?? `https://app.clickup.com/t/${clickupTaskId}`,
      clickupSyncError: undefined,
      clickupSyncedAt: now,
      updatedAt: now,
    });
  },
});
