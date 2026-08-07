import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireAuth } from "./authGuard";
import {
  SETTINGS_KEY_CONFIG,
  SETTINGS_KEY_ENABLED,
  SETTINGS_KEY_LAST_SYNC,
  SETTINGS_KEY_LAST_INBOUND,
  SETTINGS_KEY_FORCE_SYNC_DEV,
  SETTINGS_KEY_HIDDEN_AREAS,
  SETTINGS_KEY_SUBSCRIPTIONS,
  parseClickupConfig,
  type ClickupConfig,
  type ClickupProject,
  DEFAULT_CLICKUP_CONFIG,
} from "./clickupConfig";

/**
 * API pública de configuración de la integración ClickUp.
 *
 * Toda la config vive en la tabla `settings` (clave-valor):
 *   - `clickup.enabled`  → "true" | "false" (toggle global de sync outbound)
 *   - `clickup.config`   → JSON con el mapeo de proyectos/destinos (ClickupConfig)
 *   - `clickup.lastSyncAt` → timestamp del último sync outbound
 *   - `clickup.lastInboundAt` → timestamp del último scan inbound
 *
 * Las funciones públicas exigen `sessionToken` (requireAuth).
 */

const sessionArg = { sessionToken: v.string() };

// ===== Queries internas (sin auth, para usar desde actions/scheduler) =====

/** Lee un valor crudo de settings por clave. Sin auth (uso interno). */
export const _getRaw = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    return row ?? null;
  },
});

/**
 * Verifica un sessionToken desde una action (que no tiene ctx.db). Devuelve
 * true si la sesión es válida. Uso interno para actions públicas de ClickUp.
 */
export const _checkSession = internalQuery({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    if (!sessionToken) return false;
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", sessionToken))
      .first();
    return !!session && session.expiresAt > Date.now();
  },
});

/**
 * Mutation interna: actualiza las suscripciones de ClickUp (añade/quita nodos).
 * Sin auth (uso desde actions que ya validaron la sesión).
 */
export const _setSubscriptions = internalMutation({
  args: {
    add: v.array(
      v.object({
        nodeType: v.union(
          v.literal("folder"),
          v.literal("list"),
          v.literal("task"),
        ),
        id: v.string(),
        label: v.string(),
      }),
    ),
    removeIds: v.array(v.string()),
  },
  handler: async (ctx, { add, removeIds }) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_SUBSCRIPTIONS))
      .first();
    let current: { nodeType: string; id: string; label: string }[] = [];
    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value);
        if (!Array.isArray(parsed)) throw new Error("no es un array");
        current = parsed;
      } catch (err) {
        // Antes esto caía a [] y seguía de largo: la escritura siguiente
        // REEMPLAZABA todas las suscripciones por las de esta llamada, sin
        // dejar rastro. Es preferible fallar ruidosamente que perderlas.
        throw new Error(
          `Las suscripciones guardadas están corruptas y no se pueden leer; ` +
            `no se modificó nada. Detalle: ${
              err instanceof Error ? err.message : String(err)
            }`,
        );
      }
    }
    // Quitar.
    const removeSet = new Set(removeIds);
    current = current.filter((s) => !removeSet.has(s.id));
    // Añadir (sin duplicados por id).
    const existingIds = new Set(current.map((s) => s.id));
    for (const node of add) {
      if (!existingIds.has(node.id)) {
        current.push(node);
        existingIds.add(node.id);
      }
    }
    const now = Date.now();
    const value = JSON.stringify(current);
    if (row) {
      await ctx.db.patch(row._id, { value, updatedAt: now });
    } else {
      await ctx.db.insert("settings", {
        key: SETTINGS_KEY_SUBSCRIPTIONS,
        value,
        updatedAt: now,
      });
    }
  },
});

// ===== API pública =====

/**
 * Devuelve el estado completo de la integración ClickUp para la UI:
 * enabled, config parseada, y timestamps de último sync/outbound/inbound.
 */
export const getClickupState = query({
  args: sessionArg,
  handler: async (ctx, { sessionToken }) => {
    await requireAuth(ctx, sessionToken);
    const [enabledRow, configRow, lastSyncRow, lastInboundRow, forceRow, hiddenAreasRow, subsRow] = await Promise.all([
      ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_ENABLED)).first(),
      ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_CONFIG)).first(),
      ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_LAST_SYNC)).first(),
      ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_LAST_INBOUND)).first(),
      ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_FORCE_SYNC_DEV)).first(),
      ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_HIDDEN_AREAS)).first(),
      ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_SUBSCRIPTIONS)).first(),
    ]);
    // El sync outbound solo corre en producción. En dev/local las tareas NO
    // tocan ClickUp (evita ensuciar el workspace compartido con datos de test),
    // salvo que el override forceSyncDev esté activo para probar la integración.
    const deployment = process.env.CONVEX_CLOUD_DEPLOYMENT ?? "";
    const isProduction = deployment.startsWith("prod:");
    const forceSyncDev = forceRow?.value === "true";
    const syncActive =
      (isProduction || forceSyncDev) && enabledRow?.value !== "false";
    return {
      enabled: enabledRow?.value !== "false", // default true si no está seteado
      /** true solo si el outbound realmente escribirá en ClickUp. */
      syncActive,
      /** true si estamos en un deployment de desarrollo (para avisos en UI). */
      isDev: !isProduction,
      /** Override de prueba: si true, el sync corre también en dev. */
      forceSyncDev,
      config: parseClickupConfig(configRow?.value),
      lastSyncAt: lastSyncRow ? Number(lastSyncRow.value) : null,
      lastInboundAt: lastInboundRow ? Number(lastInboundRow.value) : null,
      /** Áreas ocultas en la UI (solo visualización). */
      hiddenAreas: parseHiddenAreas(hiddenAreasRow?.value),
      /** Suscripciones de ClickUp (nodos a sincronizar inbound). */
      subscriptions: parseSubscriptions(subsRow?.value),
    };
  },
});

/**
 * Devuelve el set de clickupIds que ya están importados en Hermes (tareas con
 * clickupId, no borradas). Sirve para que la página de sync marque como
 * "ya sincronizadas" las tareas que ya existen, aunque no tengan una
 * suscripción explícita.
 */
export const getImportedClickupIds = query({
  args: sessionArg,
  handler: async (ctx, { sessionToken }): Promise<string[]> => {
    await requireAuth(ctx, sessionToken);
    const all = await ctx.db.query("tasks").collect();
    return all
      .filter(
        (t) =>
          t.clickupId !== undefined &&
          t.deletedAt === undefined &&
          // Desvinculada = ya no se sigue: no debe aparecer tildada en la
          // página de suscripciones.
          !t.clickupDetached,
      )
      .map((t) => t.clickupId as string);
  },
});

/** Setea el toggle global de sync outbound (enabled on/off). */
export const setEnabled = mutation({
  args: { ...sessionArg, enabled: v.boolean() },
  handler: async (ctx, { sessionToken, enabled }) => {
    await requireAuth(ctx, sessionToken);
    await upsertSetting(ctx, SETTINGS_KEY_ENABLED, enabled ? "true" : "false");
  },
});

/** Reemplaza la config de ClickUp completa (mapeo de proyectos/destinos). */
export const setConfig = mutation({
  args: { ...sessionArg, config: v.string() },
  handler: async (ctx, { sessionToken, config }) => {
    await requireAuth(ctx, sessionToken);
    // `parseClickupConfig` NUNCA lanza: ante un JSON inválido devuelve la
    // config por defecto. Llamarla y descartar el resultado no validaba nada,
    // y después se persistía el string crudo tal cual. Ahora se valida de
    // verdad y se guarda lo parseado y normalizado.
    let parsed: unknown;
    try {
      parsed = JSON.parse(config);
    } catch {
      throw new Error("La config de ClickUp no es JSON válido");
    }
    if (!parsed || typeof parsed !== "object") {
      throw new Error("La config de ClickUp debe ser un objeto");
    }
    const normalized = parseClickupConfig(config);
    if (!normalized.mesaTecnica?.listId) {
      throw new Error("La config de ClickUp no tiene una Mesa Técnica válida");
    }
    await upsertSetting(ctx, SETTINGS_KEY_CONFIG, JSON.stringify(normalized));
  },
});

/**
 * Actualiza parcialmente la config: toggle `inbound` de Mesa Técnica o de un
 * proyecto. Es lo que usa el panel de settings para los checkboxes.
 */
export const setInbound = mutation({
  args: {
    ...sessionArg,
    /** "mesa-tecnica" para Mesa Técnica, o el id del proyecto. */
    target: v.string(),
    inbound: v.boolean(),
  },
  handler: async (ctx, { sessionToken, target, inbound }) => {
    await requireAuth(ctx, sessionToken);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_CONFIG))
      .first();
    const config: ClickupConfig = parseClickupConfig(row?.value);
    if (target === "mesa-tecnica") {
      config.mesaTecnica.inbound = inbound;
    } else {
      const proj = config.projects.find((p) => p.id === target);
      if (proj) proj.inbound = inbound;
    }
    await upsertSetting(ctx, SETTINGS_KEY_CONFIG, JSON.stringify(config));
  },
});

/**
 * Override de prueba: activa/desactiva el sync outbound en dev. Solo tiene
 * efecto fuera de producción. Sirve para validar la integración contra ClickUp
 * real desde local sin deployar. Off por defecto.
 */
export const setForceSyncDev = mutation({
  args: { ...sessionArg, force: v.boolean() },
  handler: async (ctx, { sessionToken, force }) => {
    await requireAuth(ctx, sessionToken);
    await upsertSetting(ctx, SETTINGS_KEY_FORCE_SYNC_DEV, force ? "true" : "false");
  },
});

// ===== Áreas ocultas (solo visualización) =====

/** Parsea el JSON de áreas ocultas. Devuelve [] si falta o está corrupto. */
function parseHiddenAreas(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((a) => typeof a === "string") : [];
  } catch {
    return [];
  }
}

/** Parsea el JSON de suscripciones de ClickUp. Devuelve [] si falta o corrupto. */
function parseSubscriptions(
  raw: string | undefined,
): { nodeType: string; id: string; label: string }[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (s) => s && typeof s.id === "string" && typeof s.nodeType === "string",
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * Oculta o muestra un área en la UI (solo visualización). Las tareas del área
 * siguen existiendo y sincronizándose; solo desaparecen de filtros, vista lista
 * y el TaskModal.
 */
export const toggleHiddenArea = mutation({
  args: { ...sessionArg, area: v.string(), hidden: v.boolean() },
  handler: async (ctx, { sessionToken, area, hidden }) => {
    await requireAuth(ctx, sessionToken);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_HIDDEN_AREAS))
      .first();
    const current = parseHiddenAreas(row?.value);
    const next = hidden
      ? Array.from(new Set([...current, area]))
      : current.filter((a) => a !== area);
    await upsertSetting(ctx, SETTINGS_KEY_HIDDEN_AREAS, JSON.stringify(next));
  },
});

// ===== Gestión de proyectos (auto-descubrimiento) =====

/**
 * Añade un proyecto al config trackeado. El frontend lo arma con los destinos
 * sugeridos (y/o corregidos por el usuario) tras descubrirlo.
 */
export const addProject = mutation({
  args: {
    ...sessionArg,
    /** JSON string de un ClickupProject. */
    project: v.string(),
  },
  handler: async (ctx, { sessionToken, project }) => {
    await requireAuth(ctx, sessionToken);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_CONFIG))
      .first();
    const config = parseClickupConfig(row?.value);
    const proj = JSON.parse(project) as ClickupProject;
    if (!proj.id || !proj.label || !proj.listId) {
      throw new Error("Proyecto inválido: requiere id, label y listId");
    }
    if (config.projects.some((p) => p.id === proj.id)) {
      throw new Error(`Ya existe un proyecto con id "${proj.id}"`);
    }
    config.projects.push(proj);
    await upsertSetting(ctx, SETTINGS_KEY_CONFIG, JSON.stringify(config));
  },
});

/**
 * Reemplaza un proyecto existente por id (para corregir destinos y persistir
 * las correcciones del usuario).
 */
export const updateProject = mutation({
  args: {
    ...sessionArg,
    projectId: v.string(),
    /** JSON string del ClickupProject actualizado. */
    project: v.string(),
  },
  handler: async (ctx, { sessionToken, projectId, project }) => {
    await requireAuth(ctx, sessionToken);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_CONFIG))
      .first();
    const config = parseClickupConfig(row?.value);
    const idx = config.projects.findIndex((p) => p.id === projectId);
    if (idx < 0) throw new Error(`Proyecto "${projectId}" no encontrado`);
    const proj = JSON.parse(project) as ClickupProject;
    if (!proj.label || !proj.listId) {
      throw new Error("Proyecto inválido: requiere label y listId");
    }
    config.projects[idx] = proj;
    await upsertSetting(ctx, SETTINGS_KEY_CONFIG, JSON.stringify(config));
  },
});

/** Elimina un proyecto del config trackeado por id. */
export const removeProject = mutation({
  args: { ...sessionArg, projectId: v.string() },
  handler: async (ctx, { sessionToken, projectId }) => {
    await requireAuth(ctx, sessionToken);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_CONFIG))
      .first();
    const config = parseClickupConfig(row?.value);
    config.projects = config.projects.filter((p) => p.id !== projectId);
    await upsertSetting(ctx, SETTINGS_KEY_CONFIG, JSON.stringify(config));
  },
});

/** Helper: inserta o actualiza una clave de settings. */
async function upsertSetting(
  ctx: MutationCtx,
  key: string,
  value: string,
): Promise<void> {
  const now = Date.now();
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  if (row) {
    await ctx.db.patch(row._id, { value, updatedAt: now });
  } else {
    await ctx.db.insert("settings", { key, value, updatedAt: now });
  }
}

/** Reexporta DEFAULT_CLICKUP_CONFIG para seeds o pruebas. */
export { DEFAULT_CLICKUP_CONFIG };
