import { httpRouter } from "convex/server";
import { oauthCallback } from "./clickupOAuth";

/** Endpoints HTTP públicos del deployment (site URL *.convex.site). */
const http = httpRouter();

/** Callback OAuth del MCP oficial de ClickUp (redirect_uri registrado). */
http.route({
  path: "/clickup/oauth/callback",
  method: "GET",
  handler: oauthCallback,
});

export default http;
