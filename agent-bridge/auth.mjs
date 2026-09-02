/**
 * Auth del puente: challenge-response RSA contra Convex, idéntico al login de
 * la app web y al CLI Python de Hermes (convex_tasks.py).
 *
 * La clave privada NUNCA se envía; el token de sesión se cachea 30 días en
 * agent-bridge/.token-cache.json (gitignored) y se renueva al expirar.
 */
import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { CONVEX_URL, RSA_KEY_PATH, TOKEN_CACHE } from "./config.mjs";

const SESSION_TTL_MS = 29 * 24 * 60 * 60 * 1000; // renovamos un día antes del expiry real

let cachedToken = null;
let cachedAt = 0;

function loadCachedToken() {
  if (cachedToken) return cachedToken;
  try {
    const raw = JSON.parse(readFileSync(TOKEN_CACHE, "utf8"));
    // El token SOLO vale para el deployment contra el que se emitió: si el
    // cache viene de otro (dev vs prod), reloguear — nunca mezclar.
    if (raw.token && raw.url === CONVEX_URL && Date.now() - raw.savedAt < SESSION_TTL_MS) {
      cachedToken = raw.token;
      cachedAt = raw.savedAt;
    }
  } catch {
    // sin cache válido → login fresco
  }
  return cachedToken;
}

/** Firma un challenge con la clave privada PKCS#8 (RSASSA-PKCS1-v1_5 + SHA-256). */
function signChallenge(pem, challenge) {
  const key = createPrivateKey(pem);
  const signature = cryptoSign("RSA-SHA256", Buffer.from(challenge, "utf8"), key);
  return signature.toString("base64");
}

/** Login completo: challenge → firma → token. Persiste el cache. */
export async function login() {
  const pem = readFileSync(RSA_KEY_PATH, "utf8");
  const http = new ConvexHttpClient(CONVEX_URL);
  const { challenge } = await http.action("auth:createChallenge", {});
  const signature = signChallenge(pem, challenge);
  const { token } = await http.action("auth:signInWithRsa", { challenge, signature });
  cachedToken = token;
  cachedAt = Date.now();
  writeFileSync(TOKEN_CACHE, JSON.stringify({ token, savedAt: cachedAt, url: CONVEX_URL }, null, 2));
  return token;
}

/** Token válido (cache o login). Lanza si la clave/config falla. */
export async function getToken() {
  const t = loadCachedToken();
  if (t) return t;
  return login();
}

/** Cliente autenticado por llamada (las funciones toman sessionToken como arg). */
export function httpClient() {
  return new ConvexHttpClient(CONVEX_URL);
}

/** Envoltorios cómodos con token inyectado. */
export async function q(name, args = {}) {
  const http = httpClient();
  return http.query(name, { ...args, sessionToken: await getToken() });
}

export async function m(name, args = {}) {
  const http = httpClient();
  return http.mutation(name, { ...args, sessionToken: await getToken() });
}

/** Invalida el cache (p.ej. tras un 401) y fuerza login en la próxima llamada. */
export function invalidateToken() {
  cachedToken = null;
  cachedAt = 0;
  try {
    unlinkSync(TOKEN_CACHE);
  } catch {
    // no existía
  }
}
