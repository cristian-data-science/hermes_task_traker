"use node";

/**
 * Action Node del flujo OAuth del MCP de ClickUp (ver clickupOAuthConfig.ts
 * para el porqué completo). Vive en runtime "use node" porque usa node:crypto
 * para el par PKCE; el resto del flujo (callback HTTP) está en clickupOAuth.ts.
 */
import { action } from "./_generated/server";
import crypto from "node:crypto";
import { internal } from "./_generated/api";
import { OAUTH } from "./clickupOAuthConfig";

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Genera el link de autorización con un par PKCE fresco. Sin secret: el
 *  client es público y el binding anti-CSRF lo hace `state`. */
export const requestOAuthLink = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(
      crypto.createHash("sha256").update(verifier).digest(),
    );
    const state = b64url(crypto.randomBytes(16));

    await ctx.runMutation(internal.clickupOAuth._savePair, {
      pair: { verifier, challenge, state, at: Date.now() },
    });

    const url =
      `${OAUTH.authorizeUrl}?response_type=code` +
      `&client_id=${encodeURIComponent(OAUTH.clientId)}` +
      `&redirect_uri=${encodeURIComponent(OAUTH.redirectUri)}` +
      `&scope=${encodeURIComponent(OAUTH.scopes)}` +
      `&code_challenge=${challenge}` +
      `&code_challenge_method=S256` +
      `&state=${encodeURIComponent(state)}` +
      `&resource=${encodeURIComponent(OAUTH.resource)}`;
    return { url };
  },
});
