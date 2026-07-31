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

// ===== Helpers de challenges de login (challenge-response RSA) =====

/** Helper interno: crea un challenge de login (nonce de un solo uso). */
export const _createChallenge = internalMutation({
  args: { challenge: v.string(), expiresAt: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.insert("challenges", {
      challenge: args.challenge,
      expiresAt: args.expiresAt,
      used: false,
      createdAt: args.now,
    });
    return null;
  },
});

/** Helper interno: lee un challenge por su nonce. */
export const _getChallenge = internalQuery({
  args: { challenge: v.string() },
  handler: async (ctx, { challenge }) => {
    const row = await ctx.db
      .query("challenges")
      .withIndex("by_challenge", (q) => q.eq("challenge", challenge))
      .first();
    return row ?? null;
  },
});

/** Helper interno: marca un challenge como usado (anti-replay). */
export const _markChallengeUsed = internalMutation({
  args: { challenge: v.string() },
  handler: async (ctx, { challenge }) => {
    const row = await ctx.db
      .query("challenges")
      .withIndex("by_challenge", (q) => q.eq("challenge", challenge))
      .first();
    if (row) {
      await ctx.db.patch(row._id, { used: true });
    }
    return null;
  },
});
