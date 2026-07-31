"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * Autenticación por challenge-response RSA (sin contraseña).
 *
 * Flujo:
 *  1. El cliente pide un challenge → createChallenge() devuelve un nonce
 *     aleatorio y lo guarda en la tabla `challenges` (válido 60 s, un solo uso).
 *  2. El cliente firma el nonce con su CLAVE PRIVADA (rsa_key.p8) en el
 *     navegador (Web Crypto). La clave privada NUNCA se envía al servidor.
 *  3. El cliente llama a signInWithRsa(challenge, signature) → el servidor
 *     verifica la firma con la CLAVE PÚBLICA (HERMES_RSA_PUBLIC_KEY, secreto de
 *     Convex). Si es válida y el challenge no está usado ni caducado, emite un
 *     token de sesión.
 *
 * Seguridad:
 *  - El challenge es de un solo uso (anti-replay) y caduca rápido.
 *  - La firma es RSASSA-PKCS1-v1_5 + SHA-256 (estándar, verificable con Web Crypto).
 *  - El secreto HERMES_RSA_PUBLIC_KEY vive solo en el servidor.
 */

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 60 * 1000;

function getCrypto() {
  return require("node:crypto" as string) as typeof import("node:crypto");
}

function generateToken(): string {
  return getCrypto().randomBytes(32).toString("hex");
}

/**
 * Emite un challenge de login. Pública: cualquier cliente puede pedirla,
 * pero el challenge solo sirve una vez y caduca en 60 s.
 */
export const createChallenge = action({
  args: {},
  handler: async (ctx): Promise<{ challenge: string }> => {
    const challenge = getCrypto().randomBytes(32).toString("hex");
    const now = Date.now();
    await ctx.runMutation(internal.authQuery._createChallenge, {
      challenge,
      expiresAt: now + CHALLENGE_TTL_MS,
      now,
    });
    return { challenge };
  },
});

/**
 * Verifica la firma RSA del challenge y, si es válida, crea una sesión.
 *
 * @param challenge  nonce obtenido de createChallenge().
 * @param signature  firma RSASSA-PKCS1-v1_5(SHA-256) en base64.
 */
export const signInWithRsa = action({
  args: { challenge: v.string(), signature: v.string() },
  handler: async (ctx, { challenge, signature }): Promise<{ token: string }> => {
    const crypto = getCrypto();
    const publicKeyPem = process.env.HERMES_RSA_PUBLIC_KEY;
    if (!publicKeyPem) {
      throw new Error("Auth no configurada: falta HERMES_RSA_PUBLIC_KEY");
    }

    // 1) Validar el challenge: existe, no caducado, no usado.
    const row = await ctx.runQuery(internal.authQuery._getChallenge, { challenge });
    if (!row) throw new Error("Challenge inválido");
    if (row.used) throw new Error("Challenge ya usado");
    if (row.expiresAt < Date.now()) throw new Error("Challenge expirado");

    // 2) Verificar la firma con la clave pública.
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(challenge);
    verifier.end();
    let valid = false;
    try {
      valid = verifier.verify(publicKeyPem, signature, "base64");
    } catch {
      valid = false;
    }
    if (!valid) throw new Error("Firma RSA inválida");

    // 3) Marcar el challenge como usado (anti-replay).
    await ctx.runMutation(internal.authQuery._markChallengeUsed, { challenge });

    // 4) Emitir la sesión.
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
