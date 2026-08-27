/**
 * Conexión OAuth del MCP oficial de ClickUp (https://mcp.clickup.com).
 *
 * Por qué existe esto: el workspace Patagonia negó el permiso
 * `can_use_public_api_dev_key` al personal API token (`pk_`) del usuario,
 * así que toda la API v2 da 401. El MCP oficial, en cambio, expone OAuth
 * estándar (RFC 8707 + PKCE público + Dynamic Client Registration):
 *
 *   - registration_endpoint: /oauth/register  → client_id sin admin
 *   - authorization_endpoint: /oauth/authorize (el USUARIO consiente y elige
 *     workspaces; probado: Patagonia sí aparece para este member)
 *   - token_endpoint_auth_method: none (client público, sin secret)
 *   - scopes: read/write · grants: authorization_code · PKCE: S256
 *
 * Flujo: `requestOAuthLink` (este archivo, runtime Node por el crypto)
 * genera par PKCE + state, los persiste y devuelve el link de autorización.
 * El usuario lo abre, consiente, ClickUp redirige a
 * `/clickup/oauth/callback` (ver convex/http.ts), que intercambia el code y
 * guarda el access token en settings (`clickup.mcpToken`).
 *
 * NOTA DE SEGURIDAD (app unipersonal): `requestOAuthLink` es pública sin
 * auth para poder invocarla por CLI; el peor caso es invalidar el enlace
 * pendiente (DoS del propio flujo). El callback sólo acepta redirects cuyo
 * `state` coincida con el par vigente.
 */

/** Constantes compartidas con convex/clickupOAuth.ts (runtime V8). */
export const OAUTH = {
  /** Client ID emitido por /oauth/register para redirect_uris=[REDIRECT_URI]. */
  clientId:
    "mcp-client-eyJhbGciOiJIUzI1NiIsImtpZCI6IjEifQ.eyJ0b2tlblR5cGUiOiJqd3RfY2xpZW50X2lkIiwidXJpX2hhc2hlcyI6WyJQUF9RUzdXWmVPOUY1S29OaUtiUnhRIl0sImlzcyI6ImNsaWNrdXAtbWNwLXNlcnZlciIsImlhdCI6MTc4NzgwNDgzNn0.zAM2tCdr7Cw15In2ocnEaqLMITeHgdV2b3OPmqTNnUY",
  /** Debe coincidir EXACTO con el redirect_uri registrado. */
  redirectUri:
    "https://effervescent-crab-895.convex.site/clickup/oauth/callback",
  authorizeUrl: "https://mcp.clickup.com/oauth/authorize",
  tokenUrl: () => "https://mcp.clickup.com/oauth/token",
  resource: "https://mcp.clickup.com",
  scopes: "read write",
} as const;
