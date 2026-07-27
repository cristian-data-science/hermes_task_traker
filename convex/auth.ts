"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * Auth: registro, login, logout.
 *
 * Estas son ACTIONS en runtime Node ("use node") para usar node:crypto
 * con PBKDF2 (hashing seguro). La query de verificación y los helpers de DB
 * están en convex/authQuery.ts.
 *
 * - Hashing: PBKDF2 SHA-256, 100k iteraciones, salt aleatorio de 16 bytes.
 * - Sesión: token opaco (32 bytes hex) en tabla `sessions`, 30 días de vida.
 */

const ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

function getCrypto() {
  return require("node:crypto" as string) as typeof import("node:crypto");
}

/** Hash PBKDF2. Formato: saltHex:iterations:hashHex */
function hashPassword(password: string): string {
  const crypto = getCrypto();
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, "sha256");
  return `${salt.toString("hex")}:${ITERATIONS}:${hash.toString("hex")}`;
}

/** Verifica contraseña contra el hash guardado (comparación timing-safe). */
function verifyPassword(password: string, stored: string): boolean {
  const crypto = getCrypto();
  const parts = stored.split(":");
  if (parts.length !== 3) return false;
  const [saltHex, iterStr, hashHex] = parts;
  const iterations = parseInt(iterStr, 10);
  const salt = Buffer.from(saltHex, "hex");
  const expectedHash = Buffer.from(hashHex, "hex");
  const actualHash = crypto.pbkdf2Sync(password, salt, iterations, KEY_LENGTH, "sha256");
  if (actualHash.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

function generateToken(): string {
  return getCrypto().randomBytes(32).toString("hex");
}

/**
 * Registra un nuevo usuario y abre sesión.
 * Lanza error si el email ya existe o la contraseña es muy corta.
 */
export const signUp = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }): Promise<{ token: string; email: string }> => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes("@")) {
      throw new Error("Email inválido");
    }
    if (password.length < 8) {
      throw new Error("La contraseña debe tener al menos 8 caracteres");
    }

    const existing = await ctx.runQuery(internal.authQuery._getUserByEmail, {
      email: normalizedEmail,
    });
    if (existing) {
      throw new Error("Ya existe una cuenta con ese email");
    }

    const now = Date.now();
    const token = generateToken();
    await ctx.runMutation(internal.authQuery._createUserAndSession, {
      email: normalizedEmail,
      passwordHash: hashPassword(password),
      token,
      expiresAt: now + SESSION_DURATION_MS,
      now,
    });
    return { token, email: normalizedEmail };
  },
});

/**
 * Inicia sesión. Lanza error si las credenciales son inválidas.
 */
export const signIn = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }): Promise<{ token: string; email: string }> => {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await ctx.runQuery(internal.authQuery._getUserByEmail, {
      email: normalizedEmail,
    });
    if (!user) {
      throw new Error("Email o contraseña incorrectos");
    }
    if (!verifyPassword(password, user.passwordHash)) {
      throw new Error("Email o contraseña incorrectos");
    }

    const now = Date.now();
    const token = generateToken();
    await ctx.runMutation(internal.authQuery._createSession, {
      userId: user._id,
      token,
      expiresAt: now + SESSION_DURATION_MS,
      now,
    });
    return { token, email: user.email };
  },
});

/**
 * Cierra sesión eliminando el token de la DB.
 */
export const signOut = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<null> => {
    await ctx.runMutation(internal.authQuery._deleteSession, { token });
    return null;
  },
});
