"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * Auth simple y segura para uso personal.
 *
 * Contraseña:
 *  - Se guarda hasheada (PBKDF2) en la tabla `settings` (key="passwordHash").
 *  - Si no existe ese registro, se usa la variable de entorno HERMES_PASSWORD
 *    (texto plano) como fallback inicial.
 *  - Se puede cambiar desde la app con changePassword (pide la actual).
 *
 * Sesión: token opaco de 32 bytes hex, 30 días, en tabla `sessions`.
 */

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN = 32;

function getCrypto() {
  return require("node:crypto" as string) as typeof import("node:crypto");
}

function generateToken(): string {
  return getCrypto().randomBytes(32).toString("hex");
}

/** Hash PBKDF2. Formato: saltHex:iterations:hashHex */
function hashPassword(password: string): string {
  const crypto = getCrypto();
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, "sha256");
  return `${salt.toString("hex")}:${PBKDF2_ITERATIONS}:${hash.toString("hex")}`;
}

/** Verifica una contraseña contra un hash PBKDF2 (timing-safe). */
function verifyPassword(password: string, stored: string): boolean {
  const crypto = getCrypto();
  const parts = stored.split(":");
  if (parts.length !== 3) return false;
  const [saltHex, iterStr, hashHex] = parts;
  const iterations = parseInt(iterStr, 10);
  const salt = Buffer.from(saltHex, "hex");
  const expectedHash = Buffer.from(hashHex, "hex");
  const actualHash = crypto.pbkdf2Sync(password, salt, iterations, PBKDF2_KEYLEN, "sha256");
  if (actualHash.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

/**
 * Obtiene la contraseña esperada como hash, usando la DB o la env var.
 * Devuelve { hash, isFromEnv }:
 *  - si hay registro en settings → hash = valor de la DB
 *  - si no → hash = hashPassword(HERMES_PASSWORD) (env var como texto plano)
 */
async function getExpectedPassword(ctx: any): Promise<{ hash: string; isFromEnv: boolean }> {
  const stored = await ctx.runQuery(internal.authQuery._getSetting, { key: "passwordHash" });
  if (stored) {
    return { hash: stored, isFromEnv: false };
  }
  const env = process.env.HERMES_PASSWORD;
  if (!env) {
    throw new Error("Auth no configurada: falta HERMES_PASSWORD y no hay hash en la DB");
  }
  return { hash: hashPassword(env), isFromEnv: true };
}

/**
 * Inicia sesión. Lanza error si la contraseña es incorrecta.
 * Si era la contraseña de la env var y aún no estaba en la DB, la persiste.
 */
export const signIn = action({
  args: { password: v.string() },
  handler: async (ctx, { password }): Promise<{ token: string }> => {
    const { hash, isFromEnv } = await getExpectedPassword(ctx);
    if (!verifyPassword(password, hash)) {
      throw new Error("Contraseña incorrecta");
    }
    // Si venía de la env var, lo persistimos en la DB como hash.
    if (isFromEnv) {
      await ctx.runMutation(internal.authQuery._setSetting, {
        key: "passwordHash",
        value: hash,
      });
    }

    const now = Date.now();
    const token = generateToken();
    await ctx.runMutation(internal.authQuery._createSession, {
      token,
      expiresAt: now + SESSION_DURATION_MS,
      now,
    });
    return { token };
  },
});

/** Cierra sesión eliminando el token. */
export const signOut = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<null> => {
    await ctx.runMutation(internal.authQuery._deleteSession, { token });
    return null;
  },
});

/**
 * Cambia la contraseña. Pide la actual para verificar.
 * La nueva se guarda hasheada (PBKDF2) en la DB.
 */
export const changePassword = action({
  args: {
    currentPassword: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, { currentPassword, newPassword }): Promise<null> => {
    if (newPassword.length < 6) {
      throw new Error("La nueva contraseña debe tener al menos 6 caracteres");
    }
    const { hash } = await getExpectedPassword(ctx);
    if (!verifyPassword(currentPassword, hash)) {
      throw new Error("La contraseña actual es incorrecta");
    }
    await ctx.runMutation(internal.authQuery._setSetting, {
      key: "passwordHash",
      value: hashPassword(newPassword),
    });
    return null;
  },
});
