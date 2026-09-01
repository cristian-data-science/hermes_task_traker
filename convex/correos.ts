import { v } from "convex/values";
import {
  httpAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAuth, timingSafeEqualStr } from "./authGuard";

/**
 * Ingesta de correos de Outlook (Power Automate) → tabla `correos`.
 *
 * Arquitectura: Power Automate → POST /correos/ingesta (httpAction con token
 * `x-webhook-token`) → internalMutation `ingestar`. La mutation es interna a
 * propósito: la única puerta de escritura es el HTTP action, ningún cliente
 * Convex puede insertar correos.
 *
 * Idempotencia: `messageId` (internetMessageId de Outlook). El webhook se
 * redispara cuando el correo cambia en Outlook; en ese caso se refresca el
 * contenido pero NUNCA el avance del pipeline (estado/tareaId/procesadoEn),
 * o se reprocesaría un correo que ya generó su tarea.
 */

/** Tope defensivo: los documentos Convex tienen un límite de 1 MB. */
const CUERPO_MAX = 100_000;

// ============================================================
//  internalMutation: única escritura de la tabla
// ============================================================
export const ingestar = internalMutation({
  args: {
    messageId: v.string(),
    graphId: v.string(),
    conversationId: v.optional(v.string()),
    recibidoEn: v.number(),
    remitenteEmail: v.optional(v.string()),
    remitenteNombre: v.optional(v.string()),
    asunto: v.optional(v.string()),
    cuerpo: v.string(),
    tieneAdjuntos: v.boolean(),
    adjuntos: v.optional(
      v.array(
        v.object({
          nombre: v.string(),
          tipo: v.optional(v.string()),
          tamano: v.optional(v.number()),
        }),
      ),
    ),
    webLink: v.optional(v.string()),
    categorias: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const cuerpo = args.cuerpo.slice(0, CUERPO_MAX);

    const existente = await ctx.db
      .query("correos")
      .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
      .first();

    if (existente) {
      // Redisparo del webhook: refresca contenido, jamás el avance.
      // En un patch las claves undefined no se tocan.
      await ctx.db.patch(existente._id, {
        ...(args.asunto !== undefined ? { asunto: args.asunto } : {}),
        cuerpo,
        ...(args.categorias !== undefined
          ? { categorias: args.categorias }
          : {}),
        actualizadoEn: now,
      });
      return { creado: false, id: existente._id };
    }

    const id = await ctx.db.insert("correos", {
      messageId: args.messageId,
      graphId: args.graphId,
      conversationId: args.conversationId,
      recibidoEn: args.recibidoEn,
      remitenteEmail: args.remitenteEmail,
      remitenteNombre: args.remitenteNombre,
      asunto: args.asunto,
      cuerpo,
      tieneAdjuntos: args.tieneAdjuntos,
      adjuntos: args.adjuntos,
      webLink: args.webLink,
      categorias: args.categorias,
      estado: "nuevo",
      actualizadoEn: now,
    });
    return { creado: true, id };
  },
});

// ============================================================
//  HTTP action: POST /correos/ingesta  (webhook de Power Automate)
// ============================================================
export const ingestaCorreos = httpAction(async (ctx, request) => {
  const token = request.headers.get("x-webhook-token");
  const esperado = process.env.POWER_AUTOMATE_TOKEN;
  if (!esperado) {
    // Fail-closed: sin la variable configurada, nadie ingresa nada.
    return jsonResponse(
      { error: "Ingesta no configurada: falta POWER_AUTOMATE_TOKEN" },
      500,
    );
  }
  if (!token || !timingSafeEqualStr(token, esperado)) {
    return jsonResponse({ error: "No autorizado" }, 401);
  }

  let crudo: unknown;
  try {
    crudo = await request.json();
  } catch {
    return jsonResponse({ error: "Body no es JSON válido" }, 400);
  }
  if (typeof crudo !== "object" || crudo === null) {
    return jsonResponse({ error: "Body debe ser un objeto JSON" }, 400);
  }
  const body = crudo as Record<string, unknown>;

  // Power Automate interpola las expresiones @{...} como strings: se
  // coercionan booleanos/números/fechas antes de llegar a la mutation.
  const messageId = str(body.messageId);
  const graphId = str(body.graphId);
  if (!messageId || !graphId) {
    return jsonResponse(
      { error: "messageId y graphId son obligatorios" },
      400,
    );
  }

  const fechaRaw = str(body.recibidoEn);
  const fechaParseada = fechaRaw ? Date.parse(fechaRaw) : NaN;
  const recibidoEn = Number.isFinite(fechaParseada) ? fechaParseada : Date.now();

  const resultado = await ctx.runMutation(internal.correos.ingestar, {
    messageId,
    graphId,
    conversationId: str(body.conversationId),
    recibidoEn,
    remitenteEmail: str(body.remitenteEmail),
    remitenteNombre: str(body.remitenteNombre),
    asunto: str(body.asunto),
    cuerpo: str(body.cuerpo) ?? "",
    tieneAdjuntos: bool(body.tieneAdjuntos),
    adjuntos: adjuntosDe(body.adjuntos),
    webLink: str(body.webLink),
    categorias: stringsDe(body.categorias),
  });
  return jsonResponse(resultado, 200);
});

// ============================================================
//  Consumo desde la app / el agente (sesión requerida)
// ============================================================

/** Correos en estado "nuevo", del más viejo al más nuevo (FIFO). */
export const pendientes = query({
  args: { sessionToken: v.string(), limite: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.sessionToken);
    return await ctx.db
      .query("correos")
      .withIndex("by_estado", (q) => q.eq("estado", "nuevo"))
      .order("asc")
      .take(args.limite ?? 50);
  },
});

/** Marca un correo como procesado, opcionalmente ligándolo a su tarea. */
export const marcarProcesado = mutation({
  args: {
    sessionToken: v.string(),
    messageId: v.string(),
    tareaId: v.optional(v.id("tasks")),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.sessionToken);
    const existente = await ctx.db
      .query("correos")
      .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
      .first();
    if (!existente) {
      throw new Error(`Correo no encontrado: ${args.messageId}`);
    }
    const now = Date.now();
    await ctx.db.patch(existente._id, {
      estado: "procesado",
      procesadoEn: now,
      actualizadoEn: now,
      ...(args.tareaId !== undefined ? { tareaId: args.tareaId } : {}),
    });
    return { id: existente._id };
  },
});

// ============================================================
//  Helpers de validación/coerción del payload
// ============================================================

function jsonResponse(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** String no vacío, o undefined (Power Automate manda "" si falta la propiedad). */
function str(x: unknown): string | undefined {
  return typeof x === "string" && x.length > 0 ? x : undefined;
}

/** Acepta boolean real o "true"/"false" (interpolación de Power Automate). */
function bool(x: unknown): boolean {
  return x === true || x === "true";
}

function num(x: unknown): number | undefined {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.length > 0) {
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function stringsDe(x: unknown): string[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out = x.filter((s): s is string => typeof s === "string" && s.length > 0);
  return out.length > 0 ? out : undefined;
}

function adjuntosDe(x: unknown):
  | { nombre: string; tipo?: string; tamano?: number }[]
  | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: { nombre: string; tipo?: string; tamano?: number }[] = [];
  for (const item of x) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const nombre = str(o.nombre);
    if (!nombre) continue;
    out.push({ nombre, tipo: str(o.tipo), tamano: num(o.tamano) });
  }
  return out.length > 0 ? out : undefined;
}
