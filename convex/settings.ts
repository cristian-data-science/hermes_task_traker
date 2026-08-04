import { query, mutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireAuth } from "./authGuard";
import {
  SETTINGS_KEY_CONFIG,
  SETTINGS_KEY_ENABLED,
  SETTINGS_KEY_LAST_SYNC,
  SETTINGS_KEY_LAST_INBOUND,
  SETTINGS_KEY_FORCE_SYNC_DEV,
  parseClickupConfig,
  type ClickupConfig,
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

// ===== API pública =====

/**
 * Devuelve el estado completo de la integración ClickUp para la UI:
 * enabled, config parseada, y timestamps de último sync/outbound/inbound.
 */
export const getClickupState = query({
  args: sessionArg,
  handler: async (ctx, { sessionToken }) => {
    await requireAuth(ctx, sessionToken);
    const [enabledRow, configRow, lastSyncRow, lastInboundRow, forceRow] = await Promise.all([
      ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_ENABLED)).first(),
      ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_CONFIG)).first(),
      ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_LAST_SYNC)).first(),
      ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_LAST_INBOUND)).first(),
      ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_FORCE_SYNC_DEV)).first(),
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
    };
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
    // Validar que el JSON parsea a una ClickupConfig mínimamente bien.
    parseClickupConfig(config);
    await upsertSetting(ctx, SETTINGS_KEY_CONFIG, config);
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
