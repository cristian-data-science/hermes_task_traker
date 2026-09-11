import { v } from "convex/values";
import {
  httpAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireAuth, timingSafeEqualStr } from "./authGuard";
import { logEvent } from "./events";

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
 *
 * Auto-tarea: cada correo NUEVO genera en la misma transacción una tarea
 * patagonia en estado "pendiente" (ver crearTareaDeCorreo), se publica en
 * ClickUp (Mesa Técnica) y el correo queda "procesado" con su tareaId.
 */

/** Tope defensivo: los documentos Convex tienen un límite de 1 MB. */
const CUERPO_MAX = 100_000;

/** Tope de las notas de la tarea (el cuerpo completo vive en `correos`). */
const NOTAS_MAX = 5_000;

// ============================================================
//  Tarea automática: correo nuevo → tarea "pendiente" en Patagonia
// ============================================================

/**
 * Crea la tarea de un correo entrante, la liga al correo y agenda el sync
 * con ClickUp. Mismo patrón que tasks.create/_finishPromotion: desplaza la
 * columna "pendiente" +1 e inserta arriba (order 0).
 *
 * Se llama desde `ingestar` (mismo contexto de transacción: correo y tarea
 * se crean o no se crean juntos) y desde `procesarUltimo` (backfill).
 */
async function crearTareaDeCorreo(
  ctx: MutationCtx,
  correo: Pick<
    Doc<"correos">,
    | "asunto"
    | "cuerpo"
    | "remitenteEmail"
    | "remitenteNombre"
    | "webLink"
    | "recibidoEn"
  >,
  correoId: Id<"correos">,
  now: number,
): Promise<Id<"tasks">> {
  const remitente = correo.remitenteNombre
    ? `${correo.remitenteNombre}${correo.remitenteEmail ? ` <${correo.remitenteEmail}>` : ""}`
    : (correo.remitenteEmail ?? "remitente desconocido");
  const notas = [
    `De: ${remitente}`,
    `Recibido: ${new Date(correo.recibidoEn).toISOString().slice(0, 16).replace("T", " ")} UTC`,
    ...(correo.webLink ? [`Abrir en Outlook: ${correo.webLink}`] : []),
    "",
    correo.cuerpo,
  ]
    .join("\n")
    .slice(0, NOTAS_MAX);

  // Orden: arriba de la columna "pendiente", desplazando el resto +1.
  const col = await ctx.db
    .query("tasks")
    .withIndex("by_status", (q) => q.eq("status", "pendiente"))
    .collect();
  await Promise.all(
    col
      .filter((t) => t.deletedAt === undefined)
      .sort((a, b) => a.order - b.order)
      .map((t, i) => ctx.db.patch(t._id, { order: i + 1, updatedAt: now })),
  );

  const title = correo.asunto?.trim().slice(0, 200) || "(correo sin asunto)";
  const taskId = await ctx.db.insert("tasks", {
    title,
    area: "patagonia",
    status: "pendiente",
    notes: notas || undefined,
    requestedBy: (correo.remitenteNombre ?? correo.remitenteEmail)?.slice(0, 200),
    // Origen correo: habilita "Responder con el agente" (PRD 2026-09-11).
    correoId,
    order: 0,
    createdAt: now,
    updatedAt: now,
  });

  // Bitácora: la tarea nace del correo y entra directo a "pendiente"
  // (alimenta el bloque "Entró esta semana" del catch-up).
  await logEvent(ctx, {
    taskId,
    kind: "created",
    task: { title, area: "patagonia" },
    at: now,
    toStatus: "pendiente",
    detail: "Correo entrante",
  });

  // ClickUp outbound (Mesa Técnica): mismo canal que tasks.create. Los
  // guards de entorno/enabled/área los aplica syncTask; el sessionToken no
  // se re-valida (la ingesta no tiene sesión de usuario).
  await ctx.scheduler.runAfter(0, internal.clickup.syncTask, {
    sessionToken: "",
    taskId,
    op: "create",
  });

  // Cierre del ciclo: el correo queda procesado y ligado a su tarea.
  await ctx.db.patch(correoId, {
    estado: "procesado",
    tareaId: taskId,
    procesadoEn: now,
    actualizadoEn: now,
  });
  return taskId;
}

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
    // Correo nuevo → su tarea "pendiente" en la misma transacción.
    const tareaId = await crearTareaDeCorreo(ctx, args, id, now);
    return { creado: true, id, tareaId };
  },
});

/**
 * Backfill manual: le crea la tarea al correo "nuevo" MÁS RECIENTE (mayor
 * recibidoEn) y lo marca procesado. Pensado para corridas únicas con
 * `npx convex run` (ej: correos que llegaron antes de esta automatización);
 * sin correos "nuevo" no hace nada.
 */
export const procesarUltimo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const pendientes = await ctx.db
      .query("correos")
      .withIndex("by_estado", (q) => q.eq("estado", "nuevo"))
      .order("asc")
      .collect();
    if (pendientes.length === 0) return { creado: false as const };
    const ultimo = pendientes.reduce((a, b) =>
      b.recibidoEn >= a.recibidoEn ? b : a,
    );
    const tareaId = await crearTareaDeCorreo(ctx, ultimo, ultimo._id, Date.now());
    return { creado: true as const, tareaId, correoId: ultimo._id };
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

  const remitente = remitenteDe(body.remitenteEmail);

  const resultado = await ctx.runMutation(internal.correos.ingestar, {
    messageId,
    graphId,
    conversationId: str(body.conversationId),
    recibidoEn,
    remitenteEmail: remitente.email,
    remitenteNombre: remitente.nombre ?? str(body.remitenteNombre),
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

/**
 * Borra físicamente un correo (limpieza de pruebas/triage). Idempotente:
 * si ya no existe devuelve borrado:false en vez de lanzar.
 */
export const eliminar = mutation({
  args: { sessionToken: v.string(), messageId: v.string() },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.sessionToken);
    const existente = await ctx.db
      .query("correos")
      .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
      .first();
    if (!existente) return { borrado: false };
    await ctx.db.delete(existente._id);
    return { borrado: true, id: existente._id };
  },
});

// ============================================================
//  Responder correos con el agente (PRD 2026-09-11)
// ============================================================

/**
 * Correo completo de una tarea (lo consulta el puente para armar el prompt:
 * viaja el cuerpo COMPLETO de `correos`, no el recorte de 5.000 de notes).
 */
export const correoDeTarea = query({
  args: { sessionToken: v.string(), taskId: v.id("tasks") },
  handler: async (ctx, { sessionToken, taskId }) => {
    await requireAuth(ctx, sessionToken);
    const task = await ctx.db.get(taskId);
    if (!task?.correoId) return null;
    const correo = await ctx.db.get(task.correoId);
    if (!correo) return null;
    return {
      asunto: correo.asunto,
      cuerpo: correo.cuerpo,
      remitenteEmail: correo.remitenteEmail,
      remitenteNombre: correo.remitenteNombre,
      recibidoEn: correo.recibidoEn,
      adjuntos: correo.adjuntos ?? [],
      webLink: correo.webLink,
    };
  },
});

/**
 * Backfill: estampa `correoId` en las tareas creadas por correo antes de ese
 * campo (el vínculo vivía solo en correos.tareaId). Idempotente.
 */
export const backfillCorreoId = internalMutation({
  args: {},
  handler: async (ctx) => {
    const correos = await ctx.db.query("correos").collect();
    let parchadas = 0;
    for (const c of correos) {
      if (!c.tareaId) continue;
      const task = await ctx.db.get(c.tareaId);
      if (!task || task.correoId) continue;
      await ctx.db.patch(task._id, { correoId: c._id, updatedAt: Date.now() });
      parchadas++;
    }
    return { parchadas };
  },
});

/**
 * Picker nativo — publicación del resultado: el picker local (diálogo de
 * Windows lanzado por hermesagent://pick) escribe acá con las credenciales
 * del puente. La web levanta el resultado pollando `pickResultado` por key.
 * Limpia de paso los resultados de más de 1 h (tabla efímera).
 */
export const pickReportar = mutation({
  args: {
    sessionToken: v.string(),
    key: v.string(),
    kind: v.union(v.literal("folder"), v.literal("files")),
    paths: v.optional(v.array(v.string())),
    cancelado: v.optional(v.boolean()),
  },
  handler: async (ctx, { sessionToken, key, kind, paths, cancelado }) => {
    await requireAuth(ctx, sessionToken);
    if (!/^[a-z0-9-]{8,64}$/i.test(key))
      throw new Error("key de picker inválida");
    // Solo rutas absolutas locales (las garantiza el diálogo nativo; esto
    // es la barrera de defensa si algo distinto llegara a escribir acá).
    const saneadas = (paths ?? [])
      .filter((p) => /^[a-z]:\\/i.test(p) || p.startsWith("\\\\"))
      .map((p) => p.slice(0, 300))
      .slice(0, 50);
    const now = Date.now();
    await ctx.db.insert("pickResults", {
      key,
      kind,
      ...(saneadas.length ? { paths: saneadas } : {}),
      ...(cancelado ? { cancelado } : {}),
      createdAt: now,
    });
    // Limpieza efímera: la tabla es de paso, no de historial.
    const viejas = await ctx.db.query("pickResults").collect();
    await Promise.all(
      viejas
        .filter((r) => now - r.createdAt > 60 * 60 * 1000)
        .map((r) => ctx.db.delete(r._id)),
    );
    return { ok: true };
  },
});

/** Picker nativo — resultado por key (poll de la web). */
export const pickResultado = query({
  args: { sessionToken: v.string(), key: v.string() },
  handler: async (ctx, { sessionToken, key }) => {
    await requireAuth(ctx, sessionToken);
    const row = await ctx.db
      .query("pickResults")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (!row) return { estado: "esperando" as const };
    if (row.cancelado) return { estado: "cancelado" as const };
    return { estado: "ok" as const, paths: row.paths ?? [] };
  },
});

/**
 * Delega la respuesta del correo de una tarea al agente (botón "Responder
 * con el agente"): executor=zcode + taskType="correo" + contexto (carpetas/
 * archivos del picker) + la indicación de Cris como followUp del despacho.
 */
export const responderCorreo = mutation({
  args: {
    sessionToken: v.string(),
    taskId: v.id("tasks"),
    instruccion: v.string(),
    carpetas: v.optional(v.array(v.string())),
    archivos: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { sessionToken, taskId, instruccion, carpetas, archivos }) => {
    await requireAuth(ctx, sessionToken);
    const task = await ctx.db.get(taskId);
    if (!task || task.deletedAt !== undefined)
      throw new Error("Tarea no encontrada");
    if (!task.correoId) throw new Error("La tarea no es de origen correo");
    if (task.agentState && !["hecho", "cancelada", "error"].includes(task.agentState))
      throw new Error("La tarea ya está delegada al agente");
    if (task.status === "completado")
      throw new Error("Reabre la tarea antes de delegarle la respuesta");
    const texto = instruccion.trim();
    if (!texto) throw new Error("Escribe la indicación para el agente");

    const now = Date.now();
    await ctx.db.patch(taskId, {
      executor: "zcode",
      taskType: "correo",
      agentState: "encolada",
      agentQueuedAt: now,
      agentFollowUp: texto.slice(0, 3000),
      contextPaths: {
        carpetas: carpetas ?? [],
        archivos: archivos ?? [],
      },
      updatedAt: now,
    });
    await logEvent(ctx, {
      taskId,
      kind: "agent_dispatched",
      task: { title: task.title, area: task.area },
      at: now,
      detail: "respuesta de correo delegada",
    });
    return { ok: true };
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

/**
 * Normaliza el remitente. El conector de Outlook devuelve `from` como string:
 * a veces "correo@x", a veces "Nombre <correo@x>". Extrae ambas partes.
 */
function remitenteDe(from: unknown): { email?: string; nombre?: string } {
  const raw = str(from);
  if (!raw) return {};
  const m = raw.match(/^(.*?)<([^>]+)>\s*$/);
  if (m) {
    const nombre = m[1].trim().replace(/^"|"$/g, "");
    return { email: m[2].trim(), nombre: nombre || undefined };
  }
  return /^[^@\s]+@[^@\s]+$/.test(raw) ? { email: raw } : { nombre: raw };
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
