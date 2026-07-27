import { query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * Query pública de verificación de sesión.
 * Runtime default (sin Node). Devuelve el usuario si el token es válido.
 */
export const verifySession = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!token) return null;
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!session) return null;
    if (session.expiresAt < Date.now()) return null;
    const user = await ctx.db.get(session.userId);
    if (!user) return null;
    return { email: user.email, userId: user._id };
  },
});

/**
 * Helpers internos de DB usados por las actions de auth (en auth.ts).
 * Las actions no tienen ctx.db, así que llaman a estas vía runQuery/runMutation.
 */

export const _getUserByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
  },
});

export const _createUserAndSession = internalMutation({
  args: {
    email: v.string(),
    passwordHash: v.string(),
    token: v.string(),
    expiresAt: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.db.insert("users", {
      email: args.email,
      passwordHash: args.passwordHash,
      createdAt: args.now,
    });
    await ctx.db.insert("sessions", {
      token: args.token,
      userId,
      expiresAt: args.expiresAt,
      createdAt: args.now,
    });
    return userId;
  },
});

export const _createSession = internalMutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    expiresAt: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("sessions", {
      token: args.token,
      userId: args.userId,
      expiresAt: args.expiresAt,
      createdAt: args.now,
    });
    return null;
  },
});

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
