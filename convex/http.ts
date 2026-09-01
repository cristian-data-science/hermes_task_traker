import { httpRouter } from "convex/server";
import { oauthCallback } from "./clickupOAuth";
import { ingestaCorreos } from "./correos";

/** Endpoints HTTP públicos del deployment (site URL *.convex.site). */
const http = httpRouter();

/** Callback OAuth del MCP oficial de ClickUp (redirect_uri registrado). */
http.route({
  path: "/clickup/oauth/callback",
  method: "GET",
  handler: oauthCallback,
});

/** Webhook de ingesta de correos desde Power Automate (token en header). */
http.route({
  path: "/correos/ingesta",
  method: "POST",
  handler: ingestaCorreos,
});

export default http;
