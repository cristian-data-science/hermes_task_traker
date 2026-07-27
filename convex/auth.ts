"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * Auth simple y segura para uso personal.
 *
 * - 1 sola contraseña, definida en la variable de entorno HERMES_PASSWORD
 *   del deployment de Convex (no se guarda en la DB).
 * - La contraseña se compara con node:crypto.timingSafeEqual (timing-safe).
 * - Sesión: token opaco de 32 bytes hex, 30 días de vida, en tabla `sessions`.
 * - No hay registro ni tabla de usuarios.
 */

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

function getCrypto() {
  return require("node:crypto" as string) as typeof import("node:crypto");
}

/** Compara dos strings en tiempo constante (resistente a timing attacks). */
function safeEqual(a: string, b: string): boolean {
  const crypto = getCrypto();
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function generateToken(): string {
  return getCrypto().randomBytes(32).toString("hex");
}

/**
 * Inicia sesión verificando la contraseña contra HERMES_PASSWORD.
 * Lanza error si es incorrecta. Devuelve un token de sesión.
 */
export const signIn = action({
  args: { password: v.string() },
  handler: async (ctx, { password }): Promise<{ token: string }> => {
    const expected = process.env.HERMES_PASSWORD;
    if (!expected) {
      throw new Error(
        "Auth no configurada: falta HERMES_PASSWORD en el deployment de Convex",
      );
    }
    if (!safeEqual(password, expected)) {
      throw new Error("Contraseña incorrecta");
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
