import type { QueryCtx } from "./_generated/server";

/**
 * Guards de autorización compartidos por todas las funciones de backend.
 *
 * El frontend pasa `sessionToken` en cada llamada; el backend lo verifica
 * contra la tabla `sessions` ANTES de tocar datos. Sin token válido, lanza.
 *
 * Esto cierra el agujero de "API pública": las funciones Convex dejan de ser
 * invocables sin sesión desde fuera del navegador.
 *
 * Nota de runtime: estos guards corren en queries/mutations (runtime de Convex,
 * NO Node). Por eso usan el `crypto` global (Web Crypto), disponible en ese
 * runtime, en vez de `node:crypto`.
 */

const UNAUTHORIZED = "No autorizado: sesión inválida o expirada";

/**
 * Compara dos strings en tiempo constante (mitiga timing attacks).
 * Implementación portable con TextEncoder (Web Crypto / runtime Convex).
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

/**
 * Verifica que `sessionToken` corresponde a una sesión activa (existe y no
 * ha expirado). Lanza si no es válido. Úsalo al inicio de cada query/mutation.
 *
 * Comparte la misma lógica que `verifySession`, pero como guard que lanza.
 */
export async function requireAuth(
  ctx: QueryCtx,
  sessionToken: string,
): Promise<void> {
  if (!sessionToken) throw new Error(UNAUTHORIZED);
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q) => q.eq("token", sessionToken))
    .first();
  if (!session) throw new Error(UNAUTHORIZED);
  if (session.expiresAt < Date.now()) throw new Error(UNAUTHORIZED);
}

/**
 * Verifica un token de administración (timing-safe) contra la env var
 * HERMES_ADMIN_TOKEN. Protege operaciones destructivas globales (ej. resetAndSeed).
 *
 * El token no se guarda en la DB ni en el repo: vive en los secretos de Convex
 * y se lee desde `.env.local` solo en el script de seed local.
 */
export function requireAdminToken(adminToken: string): void {
  const expected = process.env.HERMES_ADMIN_TOKEN;
  if (!expected) {
    throw new Error(
      "Administración no configurada: falta HERMES_ADMIN_TOKEN en el servidor",
    );
  }
  if (!timingSafeEqualStr(String(adminToken), expected)) {
    throw new Error("Token de administración incorrecto");
  }
}
