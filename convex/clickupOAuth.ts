/**
 * Callback HTTP del flujo OAuth del MCP oficial de ClickUp.
 *
 * El porqué completo está en clickupOAuthConfig.ts. Este archivo (runtime V8)
 * contiene el httpAction de `/clickup/oauth/callback`, que intercambia el
 * `code` por un access token (PKCE, client público sin secret) y lo persiste
 * en settings (`clickup.mcpToken`) para el resto de la integración.
 * La action que genera el link vive en clickupOAuthNode.ts ("use node").
 */
import { httpAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { OAUTH } from "./clickupOAuthConfig";

const KEY_PAIR = "clickup.mcpOauthPair"; // { verifier, challenge, state, at }
const KEY_TOKEN = "clickup.mcpToken"; // access_token crudo

/** El par PKCE vigente (para validar state y canjear el code). */
export const _getPair = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", KEY_PAIR))
      .first();
    return row?.value
      ? (JSON.parse(row.value) as {
          verifier: string;
          challenge: string;
          state: string;
          at: number;
        })
      : null;
  },
});

export const _savePair = internalMutation({
  args: {
    pair: v.object({
      verifier: v.string(),
      challenge: v.string(),
      state: v.string(),
      at: v.number(),
    }),
  },
  handler: async (ctx, { pair }) => {
    const now = Date.now();
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", KEY_PAIR))
      .first();
    if (row)
      await ctx.db.patch(row._id, { value: JSON.stringify(pair), updatedAt: now });
    else
      await ctx.db.insert("settings", {
        key: KEY_PAIR,
        value: JSON.stringify(pair),
        updatedAt: now,
      });
  },
});

export const _saveToken = internalMutation({
  args: { token: v.string(), meta: v.optional(v.string()) },
  handler: async (ctx, { token, meta }) => {
    const now = Date.now();
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", KEY_TOKEN))
      .first();
    if (row) await ctx.db.patch(row._id, { value: token, updatedAt: now });
    else
      await ctx.db.insert("settings", {
        key: KEY_TOKEN,
        value: token,
        updatedAt: now,
      });
    if (meta !== undefined) {
      const metaKey = KEY_TOKEN + ".meta";
      const mrow = await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", metaKey))
        .first();
      if (mrow)
        await ctx.db.patch(mrow._id, { value: meta, updatedAt: now });
      else
        await ctx.db.insert("settings", {
          key: metaKey,
          value: meta,
          updatedAt: now,
        });
    }
  },
});

/** Token vigente (para diagnósticos internos / UI futura). */
export const _getTokenRow = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", KEY_TOKEN))
      .first();
    return row?.value ?? null;
  },
});

// ============================================================
//  HTTP callback: /clickup/oauth/callback
// ============================================================
export const oauthCallback = httpAction(async (ctx, request) => {
  const u = new URL(request.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  const oauthErr = u.searchParams.get("error");
  if (oauthErr) {
    return htmlResponse(`Autorización rechazada: ${oauthErr}`, 400, true);
  }
  if (!code || !state) {
    return htmlResponse("Falta code/state en el callback.", 400, true);
  }

  const pair = await ctx.runQuery(internal.clickupOAuth._getPair, {});
  // Par inexistente o state distinto: no es ESTE intento de conexión.
  if (!pair || pair.state !== state) {
    return htmlResponse(
      "El enlace de autorización ya no es válido (se generó otro después). Generá uno nuevo e intentá de nuevo.",
      400,
      true,
    );
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: OAUTH.redirectUri,
    client_id: OAUTH.clientId,
    code_verifier: pair.verifier,
  });

  let resp: Response;
  try {
    resp = await fetch(OAUTH.tokenUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    return htmlResponse(
      `Error de red intercambiando el código: ${String(err)}`,
      502,
      true,
    );
  }
  const text = await resp.text();
  if (!resp.ok) {
    return htmlResponse(
      `ClickUp rechazó el canje del código (HTTP ${resp.status}):<br><pre>${escapeHtml(text)}</pre>`,
      502,
      true,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return htmlResponse("Respuesta no JSON del token endpoint.", 502, true);
  }
  const accessToken =
    typeof parsed.access_token === "string" ? parsed.access_token : null;
  if (!accessToken) {
    return htmlResponse("La respuesta no incluyó access_token.", 502, true);
  }

  const meta = JSON.stringify({
    tokenType: parsed.token_type ?? null,
    scope: parsed.scope ?? null,
    expiresAt:
      typeof parsed.expires_in === "number"
        ? Date.now() + parsed.expires_in * 1000
        : null,
    hasRefresh: typeof parsed.refresh_token === "string",
    savedAt: Date.now(),
  });
  await ctx.runMutation(internal.clickupOAuth._saveToken, {
    token: accessToken,
    meta,
  });

  return htmlResponse(
    `✅ <strong>ClickUp conectado</strong>. El token quedó guardado.<br>` +
      `Volvé a la app de Hermes e avisale a Cris para seguir.<br><br>` +
      `<details><summary>Ver token (solo diagnóstico — no compartir)</summary><pre style="white-space:break-spaces">${escapeHtml(accessToken)}</pre></details>`,
    200,
  );
});

function htmlHeaders(): Record<string, string> {
  return { "Content-Type": "text/html; charset=utf-8" };
}
function htmlResponse(body: string, status: number, isError = false): Response {
  void isError;
  return new Response(html(body), { status, headers: htmlHeaders() });
}
function html(body: string): string {
  return (
    `<!doctype html><meta charset="utf-8"><title>Hermes ↔ ClickUp</title>` +
    `<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0">` +
    `<div style="max-width:560px;padding:24px;border-radius:12px;border:1px solid #ddd;color:#222">${body}</div>`
  );
}
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );
}
