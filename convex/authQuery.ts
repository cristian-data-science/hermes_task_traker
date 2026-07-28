import { query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * Query pública: verifica un token de sesión.
 * Devuelve true si el token existe y no ha expirado, false en caso contrario.
 */
export const verifySession = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!token) return false;
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!session) return false;
    if (session.expiresAt < Date.now()) return false;
    return true;
  },
});

/** Helper interno: crea una sesión. */
export const _createSession = internalMutation({
  args: { token: v.string(), expiresAt: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.insert("sessions", {
      token: args.token,
      expiresAt: args.expiresAt,
      createdAt: args.now,
    });
    return null;
  },
});

/** Helper interno: elimina una sesión por token. */
export const _deleteSession = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (session) {
      await ctx.db.delete(session._id);
    }
    return null;
  },
});

/** Helper interno: lee un setting por clave. */
export const _getSetting = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    return row?.value ?? null;
  },
});

/** Helper interno: upsert de un setting. */
export const _setSetting = internalMutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, { key, value }) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("settings", { key, value, updatedAt: Date.now() });
    }
    return null;
  },
});
