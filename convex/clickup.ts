"use node";

import { internalAction, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  CLICKUP_USER_ID,
  CLICKUP_SPACE_ID,
  SETTINGS_KEY_CONFIG,
  SETTINGS_KEY_ENABLED,
  SETTINGS_KEY_FORCE_SYNC_DEV,
  SETTINGS_KEY_IMPREVISTOS_PARENT,
  parseClickupConfig,
  resolveOutboundDestination,
  isProductionDeployment,
  type HermesStatus,
} from "./clickupConfig";

/**
 * Integración con ClickUp (REST API v2) — solo área `patagonia`.
 *
 * Outbound: al crear/editar/completar/eliminar una tarea en Hermes, se refleja
 * en ClickUp. Se dispara vía `ctx.scheduler.runAfter(0, ...)` desde `tasks.ts`,
 * así no bloquea la mutación y habilita reintentos.
 *
 * Este archivo usa `"use node"` (runtime Node) porque hace `fetch` a la API de
 * ClickUp. Las mutaciones que persisten el resultado viven en clickupMutations.ts
 * (runtime V8) y se invocan vía `ctx.runMutation(internal.clickupMutations.X)`.
 *
 * Auth: OAuth/MCP con token Bearer persistido en settings
 * (`clickup.mcpToken`, ver clickupOAuthConfig.ts). El personal token `pk_`
 * quedó descartado: el workspace Patagonia le negó
 * `can_use_public_api_dev_key` y toda la REST v2 devolvía 401.
 *
 * Reglas:
 *  - Solo tareas con `area === "patagonia"` se sincronizan.
 *  - Si `settings.clickup.enabled === false`, no hace nada (sync en pausa).
 *  - Eliminar en Hermes = desvincular (limpiar clickupId), no borrar en ClickUp,
 *    salvo que se pida borrado explícito (op="delete").
 */

// ============================================================
//  Transporte MCP (OAuth) — canal vigente desde que el workspace
//  Patagonia negó `can_use_public_api_dev_key` al personal token.
//  El flujo de conexión vive en clickupOAuth.ts; el token queda en
//  settings (`clickup.mcpToken`). La API REST clásica sigue usándose
//  con CLICKUP_API_KEY donde todavía responda (inbound, pendiente).
// ============================================================

const MCP_URL = "https://mcp.clickup.com/mcp";

/** Token OAuth del guardado por el callback (`clickupOAuth._saveToken`). */
async function getMcpToken(ctx: unknown): Promise<string | null> {
  const row = await (
    ctx as { runQuery: (q: unknown, a?: unknown) => Promise<unknown> }
  ).runQuery(internal.clickupOAuth._getTokenRow, {});
  return (row as string | null) ?? null;
}

/** Igual que getMcpToken pero lanza con instrucción clara si falta. */
export async function requireMcpToken(ctx: unknown): Promise<string> {
  const token = await getMcpToken(ctx);
  if (!token)
    throw new Error(
      "ClickUp no conectado vía OAuth/MCP. Generá el enlace con clickupOAuthNode.requestOAuthLink e autorizá el workspace.",
    );
  return token;
}

/**
 * Invoca una tool del servidor MCP de ClickUp.
 *
 * La respuesta puede llegar como JSON puro o envuelta en SSE
 * (`event: message\ndata: {...}`); se parsea en modo dual. Lanza ante HTTP
 * distinto de 2xx, error JSON-RPC o `result.isError`. Devuelve `result`.
 */
export async function mcpCall(
  toolName: string,
  toolArgs: Record<string, unknown>,
  token: string,
): Promise<any> {
  const resp = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1_000_000_000),
      method: "tools/call",
      params: { name: toolName, arguments: toolArgs },
    }),
  });
  const raw = await resp.text();
  if (!resp.ok) throw new Error(`MCP ${resp.status}: ${raw.slice(0, 300)}`);

  // Parse dual: JSON directo o SSE con una o más líneas `data: {json}`.
  let payload: any;
  try {
    const dataIdx = raw.indexOf("data:");
    if (dataIdx >= 0) {
      const brace = raw.indexOf("{", dataIdx);
      payload = JSON.parse(raw.slice(brace));
    } else {
      payload = JSON.parse(raw);
    }
  } catch {
    throw new Error(`MCP respuesta ilegible: ${raw.slice(0, 200)}`);
  }
  if (payload.error) {
    throw new Error(
      `MCP error ${payload.error.code}: ${JSON.stringify(payload.error.message ?? payload.error)}`,
    );
  }
  const result = payload.result;
  if (!result) throw new Error("MCP respuesta sin result");
  if (result.isError) throw new Error(mcpContentText(result));
  return result;
}

/** Concatena el texto útil de result.content (bloques type:"text"). */
function mcpContentText(result: any): string {
  const c = result?.content;
  if (Array.isArray(c)) {
    return c
      .map((x: any) => (typeof x?.text === "string" ? x.text : ""))
      .join("\n");
  }
  return typeof result === "string" ? result : JSON.stringify(result ?? {});
}

/** El resultado estructurado preferente; fallback al content parseado. */
export function mcpStructured(result: any): any {
  if (result?.structuredContent) return result.structuredContent;
  const text = mcpContentText(result);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** ¿El mensaje corresponde a una tarea que ya no existe en ClickUp? */
export function mcpIsNotFound(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("404") ||
    m.includes("not found") ||
    m.includes("does not exist") ||
    m.includes("no se encontró")
  );
}

/** Tope del comentario-resumen que se le manda a ClickUp al completar. */
const COMMENT_MAX_CHARS = 1200;

// ============================================================
//  Sanitización de referencias locales en el comentario del agente
// ============================================================

/**
 * Extensiones típicas de archivos de trabajo/reporte. Se listan explícitas
 * (y no como `\.\w+`) para no manglear dominios ("app.clickup.com") ni
 * versiones ("v1.2").
 */
const FILE_EXT_RE =
  /\.(md|pbix|csv|xlsx|xls|docx|pdf|png|jpe?g|gif|svg|json|txt|log|py|js|mjs|cjs|ts|tsx|sql|zip|parquet|html?|css|ya?ml|toml|ini|env)\b/gi;

/**
 * Copia SIN flag g para .test(): una regex con /g mantiene lastIndex entre
 * llamadas y alterna resultados true/false — bug clásico que acá haría que
 * la mitad de los archivos con extensión se escapen del sanitizador.
 */
const FILE_EXT_TEST = new RegExp(FILE_EXT_RE.source, "i");

/** ¿Qué pedazo de una ruta es el "nombre de archivo"? */
function basenameNoExt(p: string): string {
  const last = p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  return last.replace(FILE_EXT_RE, "").trim();
}

/**
 * Quita referencias locales del texto que viaja a ClickUp (comentario del
 * agente al completar). Allá lo lee un cliente: rutas de TU computadora
 * ("C:\Users\patag\...") y archivos con extensión ("CAMBIOS.md") no tienen
 * sentido — el detalle completo vive en Hermes, donde sí podés abrirlos.
 *
 * Reglas (acordadas con Cris): rutas absolutas → solo el nombre del archivo
 * final sin extensión; archivos con extensión sueltos → nombre sin extensión.
 * El resto del texto queda intacto (sanitizador conservador: nunca reescribe
 * frases, solo neutraliza los token inequívocamente locales).
 */
function sanitizeLocalRefs(text: string): string {
  return (
    text
      // Rutas Windows (C:\...) y POSIX absolutas (/home/..., /mnt/...).
      .replace(
        /\b[A-Za-z]:\\[^\s"')\]]+|\/(?:home|Users|mnt|var|tmp|opt|root)\/[^\s"')\]]+/g,
        (m) => basenameNoExt(m),
      )
      // Archivos con extensión sueltos: "CAMBIOS.md" → "CAMBIOS".
      .replace(/\b[\w .-]{1,80}\.[A-Za-z]\w{0,8}\b/g, (m) => {
        return FILE_EXT_TEST.test(m) ? basenameNoExt(m) : m;
      })
  );
}

/** ¿El mensaje dice que esa tool no existe en el servidor MCP? */
function mcpIsUnknownTool(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("unknown tool") ||
    m.includes("unknown_tool") ||
    m.includes("invalid tool") ||
    m.includes("no such tool") ||
    m.includes("tool not found")
  );
}

/**
 * Tools MCP candidatas para comentarios. La doc oficial lista "Create Task
 * Comment" sin nombre de tool; los catálogos públicos del servidor oficial la
 * nombran clickup_create_task_comment (task_id y comment_text requeridos).
 * Se prueban en orden: la primera que exista gana; si ninguna existe, el
 * error queda visible en clickupSyncError.
 */
const COMMENT_TOOL_CANDIDATES = [
  "clickup_create_task_comment",
  "clickup_add_comment",
  "clickup_create_comment",
];

/**
 * Agrega un comentario a una tarea de ClickUp vía MCP. Si una candidata no
 * existe (error de tool desconocida) prueba la siguiente; cualquier otro
 * error se propaga (el caller lo registra en clickupSyncError).
 */
async function mcpAddComment(
  taskId: string,
  commentText: string,
  token: string,
): Promise<void> {
  let lastUnknown: Error | null = null;
  for (const tool of COMMENT_TOOL_CANDIDATES) {
    try {
      await mcpCall(
        tool,
        { task_id: taskId, comment_text: commentText },
        token,
      );
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (mcpIsUnknownTool(msg)) {
        lastUnknown = err instanceof Error ? err : new Error(msg);
        continue;
      }
      throw err;
    }
  }
  throw (
    lastUnknown ?? new Error("Ninguna tool MCP de comentarios disponible")
  );
}

/**
 * Argumentos para create_task/update_task derivados de la tarea Hermes.
 * Replica las reglas del ex buildTaskBody (REST) en el formato de las tools
 * MCP: claves indefinidas se OMITEN (update nunca limpia fecha/estimación:
 * limpiarlas es una limitación menor por ahora).
 */

function mcpTaskArgs(task: Doc<"tasks">): Record<string, unknown> {
  const metaLines: string[] = [];
  if (task.notes) metaLines.push(task.notes);
  if (task.requestedBy) metaLines.push(`Solicitado por: ${task.requestedBy}`);
  if (typeof task.progress === "number")
    metaLines.push(`Progreso: ${task.progress}%`);

  const args: Record<string, unknown> = {
    name: task.title,
    // Descripción SIEMPRE (igual que el REST): vacía = " ".
    markdown_description: metaLines.join("\n\n") || " ",
    status: mapStatusToClickUp(task.status),
    // urgente → urgent, en-curso → high, resto → normal (se manda siempre
    // para que al salir de urgente/en-curso ClickUp la baje). La tool MCP
    // espera STRINGS de prioridad, no el 1/2/3 numérico del REST.
    priority:
      task.status === "urgente"
        ? "urgent"
        : task.status === "en-curso"
          ? "high"
          : "normal",
    // La tool MCP espera IDs como STRING (el REST los quería number).
    assignees: [CLICKUP_USER_ID],
  };

  const dueMs = parseDateToMs(task.dueDate);
  // La tool MCP quiere YYYY-MM-DD ('none'/fecha), no epoch. La app guarda
  // fechas sin hora: toISOString en UTC conserva el día tal cual se cargó.
  if (dueMs !== null) args.due_date = new Date(Number(dueMs)).toISOString().slice(0, 10);
  const estimateMs = parseEstimateMs(task.estimate);
  if (estimateMs !== null) args.time_estimate = String(estimateMs);

  for (const k of Object.keys(args)) {
    if (args[k] === undefined) delete args[k];
  }
  return args;
}

// ============================================================
//  Lecturas MCP compartidas (fase picker/bandeja/inbound)
//
// Estrategia: las tools devuelven shapes propios; los helpers acá abajo los
// NORMALIZAN al formato legacy de la REST v2 que consumen todas las funciones
// de este módulo (status:{status}, fechas ms, orderindex, etc.). Así cada
// migración toca únicamente la capa de transporte, no cada consumer.
// ============================================================

interface McpTreeNode {
  id: string;
  name: string;
  type: string;
  children?: McpTreeNode[];
}

/**
 * Convierte una fila de clickup_filter_tasks / clickup_get_task.subtasks al
 * shape legacy de tarea REST. `extra` agrega campos que esas tools no traen
 * (ej. parent conocido por construcción, folder de la iteración).
 */
function normalizeMcpTaskRow(
  t: any,
  extra: Record<string, unknown> = {},
  orderindex?: number,
): any {
  return {
    id: t.id,
    name: t.name,
    url: t.url,
    // filter_tasks NO trae `parent`: quien lo necesita lo estampa por
    // construcción (expansión jerárquica) o usa get_task.
    parent:
      extra.parent !== undefined
        ? extra.parent
        : typeof t.parent === "string"
          ? t.parent
          : undefined,
    status: {
      status: t.status ?? "to do",
      date_closed: t.date_closed ?? null,
    },
    priority:
      typeof t.priority === "string"
        ? { priority: t.priority }
        : (t.priority ?? undefined),
    list: t.list ? { id: t.list.id, name: t.list.name } : undefined,
    folder: t.folder
      ? { id: t.folder.id, name: t.folder.name }
      : extra.folder,
    space: t.space?.id ? { id: t.space.id } : undefined,
    assignees: (t.assignees ?? []).map((a: any) => ({
      id: Number(a.id),
      username: a.username,
    })),
    due_date: t.due_date ?? null,
    start_date: t.start_date ?? null,
    time_estimate: t.time_estimate ?? null,
    description: t.description,
    text_content: t.text_content,
    orderindex: orderindex ?? Number.MAX_SAFE_INTEGER - Math.random(),
    custom_id: t.custom_id ?? null,
  };
}

/** Equivalente legacy de GET /task/{id}: tarea completa (opción subtareas). */
async function mcpGetTaskLegacy(
  ctx: unknown,
  taskId: string,
  include?: string[],
): Promise<any> {
  const token = await requireMcpToken(ctx);
  const args: Record<string, unknown> = { task_id: taskId };
  if (include?.length) args.include = include;
  const t: any =
    mcpStructured(await mcpCall("clickup_get_task", args, token)) ?? {};
  const row = normalizeMcpTaskRow(t);
  // La normalización es plana por diseño; las subtareas crudas viajan aparte
  // para los navegadores jerárquicos (listTaskChildren & co).
  if (Array.isArray(t.subtasks)) row.subtasks = t.subtasks;
  if (typeof t.subtasks_count === "number")
    row.subtasks_count = t.subtasks_count;
  return row;
}

/**
 * Árbol del workspace paginado: devuelve los CHILDREN del space CLICKUP_SPACE_ID
 * (folders y lists sueltas mezclados, tipo "folder"/"list").
 */
async function mcpSpaceNodes(
  ctx: unknown,
): Promise<McpTreeNode[]> {
  const token = await requireMcpToken(ctx);
  const spaces: McpTreeNode[] = [];
  let cursor: string | undefined;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const args: Record<string, unknown> = { max_depth: "2", limit: 50 };
    if (cursor) args.cursor = cursor;
    const sc: any =
      mcpStructured(
        await mcpCall("clickup_get_workspace_hierarchy", args, token),
      ) ?? {};
    const root = sc.hierarchy?.root;
    for (const s of (root?.children ?? []) as any[]) {
      const existing = spaces.find((x) => x.id === s.id);
      if (!existing) {
        spaces.push(s);
      } else if (Array.isArray(s.children)) {
        existing.children = [...(existing.children ?? []), ...s.children];
      }
    }
    if (!sc.has_more || !sc.next_cursor) break;
    cursor = String(sc.next_cursor);
  }
  for (const s of spaces) if (s.id === CLICKUP_SPACE_ID) return s.children ?? [];
  return [];
}

/**
 * Folders del space con sus lists embebidas — shape equivalente al viejo
 * `GET /space/{id}/folder`. Los contenedores sin lists se descartan igual.
 */
async function mcpSpaceFolders(
  ctx: unknown,
): Promise<{ id: string; name: string; lists: { id: string; name: string; archived: false }[] }[]> {
  const nodes = await mcpSpaceNodes(ctx);
  const out: { id: string; name: string; lists: { id: string; name: string; archived: false }[] }[] = [];
  for (const node of nodes) {
    if (node.type !== "folder") continue;
    const lists = (node.children ?? [])
      .filter((c) => c.type === "list")
      .map((c) => ({ id: c.id, name: c.name, archived: false as const }));
    if (lists.length === 0) continue; // contenedor sin lists: no es destino
    out.push({
      id: node.id,
      name: node.name ?? "Sin nombre",
      lists,
    });
  }
  return out;
}

/**
 * TODAS las tareas de una list con `parent` EXPLÍCITO y orderindex sintético
 * estable. Estrategia: raíces vía filter_tasks(subtasks:false — ClickUp excluye
 * a TODAS las descendientes) y expansión nivel-por-nivel con get_task(include
 * subtasks), estampando el padre por construcción. Así el bandeja/backfill/
 * buscan ancestros exactamente como antes.
 *
 * Si le pasan `folder`, estampa folder en cada fila (para las rutas inbound).
 */
async function fetchAllListTasksWithParents(
  ctx: unknown,
  listId: string,
  folder?: { id?: string; name?: string },
): Promise<any[]> {
  const token = await requireMcpToken(ctx);
  const all: any[] = [];

  // 1) Raíces de la list (subtasks=false ⇒ ninguna descendiente).
  let page = 0;
  let idx = 0;
  const queue: { id: string; parent: string | null }[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const fa: Record<string, unknown> = {
      list_ids: [listId],
      include_closed: false,
      subtasks: false,
      page,
    };
    if (folder?.id) fa.folder_ids = [folder.id];
    const sc: any =
      mcpStructured(await mcpCall("clickup_filter_tasks", fa, token)) ?? {};
    for (const row of sc.tasks ?? []) {
      const norm = normalizeMcpTaskRow(row, { parent: null, folder }, idx++);
      all.push(norm);
      queue.push({ id: norm.id, parent: null });
    }
    const next = sc.next_page;
    if (!sc.has_more || typeof next !== "number" || next <= page) break;
    page = next;
  }

  // 2) Expansión en amplitud de los descendientes con su padre real.
  let depth = 0;
  let frontier = [...queue];
  const seen = new Set<string>(frontier.map((f) => f.id));
  while (frontier.length && depth < 8) {
    depth++;
    const kids: any[] = [];
    const batch = await Promise.all(
      frontier.map((f) =>
        mcpCall(
          "clickup_get_task",
          { task_id: f.id, include: ["subtasks"] },
          token,
        ).catch(() => null),
      ),
    );
    frontier = [];
    for (const r of batch) {
      if (!r) continue;
      const t: any = mcpStructured(r) ?? {};
      for (const subRaw of t.subtasks ?? []) {
        if (seen.has(subRaw.id)) continue;
        seen.add(subRaw.id);
        const norm = normalizeMcpTaskRow(
          subRaw,
          { parent: t.id, folder },
          idx++,
        );
        all.push(norm);
        kids.push(norm);
        if ((subRaw.subtasks_count ?? 0) > 0)
          frontier.push({ id: norm.id, parent: t.id });
      }
    }
    if (kids.length === 0) break;
  }
  void queue;
  return all;
}

// ===== Mapeo de estados Hermes (6) ↔ ClickUp (3) =====

/** Mapea un estado de Hermes a uno de ClickUp (3 estados, con pérdida). */
function mapStatusToClickUp(status: HermesStatus): string {
  switch (status) {
    case "completado":
      return "complete";
    case "en-curso":
      return "in progress";
    default:
      return "to do";
  }
}

/**
 * Mapea un estado de ClickUp (3) a uno de Hermes (6). El default es
 * "pendiente". Es el valor sugerido en el modal de sync reversa, editable
 * por el usuario item por item.
 */
function mapStatusFromClickUp(clickupStatus: string): HermesStatus {
  switch (clickupStatus) {
    case "complete":
      return "completado";
    case "in progress":
      return "en-curso";
    default:
      return "pendiente";
  }
}

// ===== Parseo de estimación y fechas =====

/**
 * Intenta parsear un texto de estimación ("4h", "30 min", "2 horas") a ms.
 * Retorna null si no es parseable (1h = 3600000 ms).
 */
function parseEstimateMs(estimate: string | undefined): number | null {
  if (!estimate) return null;
  const m = estimate
    .toLowerCase()
    .match(/(\d+(?:[.,]\d+)?)\s*(h|hora|horas|hr|hrs|min|m|minuto|minutos)?/);
  if (!m) return null;
  const value = parseFloat(m[1].replace(",", "."));
  if (Number.isNaN(value)) return null;
  const unit = m[2] ?? "h";
  const isMinutes = unit.startsWith("m");
  const hours = isMinutes ? value / 60 : value;
  return Math.round(hours * 3600000);
}

/**
 * Convierte una fecha string (ej. "2026-07-29") a ms Unix como MEDIODÍA UTC
 * del día elegido.
 *
 * ClickUp tiene una regla documentada: las fechas sin hora (due_date_time:
 * false) se anclan internamente a las 4 AM en la zona horaria local del
 * usuario. Si mandamos medianoche UTC y el usuario está detrás de UTC (Chile
 * UTC-3/-4), ClickUp shiftea la fecha al día anterior → "ayer".
 *
 * Mandar mediodía UTC (12:00Z) del día elegido garantiza que, en cualquier zona
 * horaria razonable (UTC-12 a UTC+12), el timestamp siga cayendo en el mismo
 * día calendario, y la normalización a 4 AM local de ClickUp no lo mueva.
 *
 * Soporta formatos: "YYYY-MM-DD" (DatePicker), ISO con hora, "29-jul-2026".
 */
function parseDateToMs(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const s = dateStr.trim();
  // Caso 1: "YYYY-MM-DD" (formato que emite el DatePicker). Parseamos a mano
  // y construimos mediodía UTC.
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const noonUtc = Date.UTC(Number(y), Number(m) - 1, Number(d), 12, 0, 0, 0);
    return Number.isNaN(noonUtc) ? null : noonUtc;
  }
  // Caso 2: otros formatos ("29-jul-2026", ISO con hora, etc.) → Date.parse.
  const ts = Date.parse(s);
  return Number.isNaN(ts) ? null : ts;
}

// ===== Construcción del body de tarea ClickUp =====

// ===== Acción principal: syncTask (outbound) =====

/**
 * Sincroniza una tarea de Hermes hacia ClickUp. Orquesta create/update/delete
 * según `op` y el estado de la tarea.
 *
 * Es una internalAction (runtime Node, solo invocable vía scheduler desde
 * tasks.ts). La mutación caller YA validó la sesión antes de agendarla, así que
 * aquí no re-validamos: las actions no tienen `ctx.db` para hacerlo, y
 * re-validar requeriría otra ronda de query innecesaria.
 */
export const syncTask = internalAction({
  args: {
    sessionToken: v.string(),
    taskId: v.id("tasks"),
    op: v.union(
      v.literal("create"),
      v.literal("update"),
      v.literal("status"),
      v.literal("complete"),
      v.literal("delete"),
    ),
  },
  handler: async (ctx, { taskId, op }) => {
    // 1) Guard de entorno: el sync outbound SOLO corre en producción.
    // En dev/local está bloqueado por defecto para no ensuciar el workspace
    // ClickUp compartido (Patagonia) con datos de test. Existe un override
    // (settings clickup.forceSyncDev=true) para forzarlo y probar la
    // integración desde local; off por defecto.
    if (!isProductionDeployment()) {
      const forceRow = await ctx.runQuery(internal.settings._getRaw, {
        key: SETTINGS_KEY_FORCE_SYNC_DEV,
      });
      if (forceRow?.value !== "true") return;
    }

    // 2) ¿Está habilitado el sync? Si no, salir silenciosamente.
    const enabledRow = await ctx.runQuery(internal.settings._getRaw, {
      key: SETTINGS_KEY_ENABLED,
    });
    if (enabledRow?.value === "false") return;

    // 2) Cargar la tarea. Si fue borrada y op != delete, nada que hacer.
    const task = await ctx.runQuery(internal.tasks._getInternal, { taskId });
    if (!task) return;

    // 3) Solo área patagonia. datacef/personal nunca tocan ClickUp.
    // Las tareas "solo local" tampoco: guard de defensa por si un sync quedó
    // agendado justo antes de activar el check.
    if (task.area !== "patagonia" || task.clickupLocal) return;

    // 3.b) Desvinculada a mano: no se escribe NADA en ClickUp, ni siquiera el
    // borrado. Es la garantía de "esta tarea ya no le pertenece a ClickUp".
    if (task.clickupDetached) return;

    // 4) Cargar config para resolver el destino (list/parent).
    const configRow = await ctx.runQuery(internal.settings._getRaw, {
      key: SETTINGS_KEY_CONFIG,
    });
    const config = parseClickupConfig(configRow?.value);
    // El listId elegido en el picker manda cuando la tarea es plana (sin
    // parent): sin esto, toda tarea sin parent caía en Mesa Técnica aunque el
    // usuario hubiera elegido otro proyecto.
    const dest = resolveOutboundDestination(
      config,
      task.clickupParentId,
      task.clickupListId,
    );

    // Id en ClickUp tras este sync (cambia si la tarea se crea acá abajo).
    let finalClickupId: string | undefined = task.clickupId;
    /**
     * Nota al completar: si la tarea quedó COMPLETADA y la hizo el agente,
     * se agrega a la tarea de ClickUp un comentario con el resumen de lo que
     * se hizo (el que el agente reportó al terminar). Sin encabezado: el
     * comentario ES el resumen. Sin completar no hay nota; sin resumen
     * (corrida sin summary) tampoco.
     * Idempotencia: clickupCommentedAt es la última nota enviada; solo se
     * comenta de nuevo si completedAt quedó más nuevo (se reabrió y volvió a
     * completar), así un re-sync nunca duplica el comentario.
     */
    const postCompletionNote = async (): Promise<void> => {
      if (!finalClickupId) return;
      if (task.status !== "completado" || task.executor !== "zcode") return;
      if (!task.completedAt) return;
      if (
        task.clickupCommentedAt !== undefined &&
        task.clickupCommentedAt >= task.completedAt
      )
        return;
      const runInfo = await ctx.runQuery(internal.agent._latestRunWithSummary, {
        taskId,
      });
      if (!runInfo?.summary) return;
      const token = await requireMcpToken(ctx);
      await mcpAddComment(
        finalClickupId,
        // Sin referencias locales: allá lo lee un cliente, las rutas de tu PC
        // y los ".md" no le dicen nada. El detalle completo vive en Hermes.
        sanitizeLocalRefs(runInfo.summary).slice(0, COMMENT_MAX_CHARS),
        token,
      );
      await ctx.runMutation(internal.clickupMutations._markCommented, {
        taskId,
      });
    };

    try {
      if (op === "delete") {
        // Borrado explícito: eliminar en ClickUp si estaba sincronizada.
        if (task.clickupId) {
          const token = await requireMcpToken(ctx);
          try {
            await mcpCall(
              "clickup_delete_task",
              { task_id: task.clickupId },
              token,
            );
          } catch {
            // Ya no existe allá (borrada a mano): desvincular igualmente.
          }
        }
        await ctx.runMutation(internal.clickupMutations._unlinkClickUp, { taskId });
        return;
      }

      // Si la tarea fue soft-deleted en Hermes pero op no es delete, la
      // desvinculamos sin borrar en ClickUp (comportamiento por defecto).
      if (task.deletedAt !== undefined) {
        await ctx.runMutation(internal.clickupMutations._unlinkClickUp, { taskId });
        return;
      }

      if (!task.clickupId) {
        // ===== CREATE =====
        // Publicación por defecto: toda tarea de Patagonia no marcada "solo
        // local" se crea en ClickUp. Sin destino elegido en el picker cae en
        // Mesa Técnica (resolveOutboundDestination, caso 4) — igual a como se
        // ve en la UI. El check "solo local" es el único opt-out.
        const token = await requireMcpToken(ctx);
        // create_task MCP anida en el MISMO call (`parent` es un argumento),
        // a diferencia de la API REST donde el POST lo ignoraba. Con parent,
        // ClickUp coloca la tarea en la list donde vive el padre; igual
        // persistimos dest.listId como respaldo hasta resolver la ruta real.
        const args = mcpTaskArgs(task);
        args.list_id = dest.listId;
        if (dest.parentId) args.parent = dest.parentId;
        const created = await mcpCall("clickup_create_task", args, token);
        const sc = mcpStructured(created) ?? {};
        const newId = String(sc.task_id ?? "");
        if (!newId) throw new Error("create_task no devolvió task_id");
        finalClickupId = newId;
        const newUrl = String(sc.task_url ?? `https://app.clickup.com/t/${newId}`);

        await ctx.runMutation(internal.clickupMutations._markSynced, {
          taskId,
          clickupId: newId,
          clickupUrl: newUrl,
          clickupListId: dest.listId,
        });
        // Resolver la ruta ya: sin esto, la tarea linkeada a un proyecto
        // seguía agrupada en «Sueltas» hasta el recálculo manual.
        await syncClickupPath(ctx, taskId, newId);
      } else {
        // ===== UPDATE (incluye status/complete) =====
        const token = await requireMcpToken(ctx);
        try {
          await mcpCall(
            "clickup_update_task",
            { task_id: task.clickupId, ...mcpTaskArgs(task) },
            token,
          );
        } catch (updateErr) {
          // Si la tarea fue borrada en ClickUp, la desvinculamos y la
          // recreamos en el destino correcto en vez de dejarla con error rojo.
          const msg =
            updateErr instanceof Error ? updateErr.message : String(updateErr);
          if (mcpIsNotFound(msg)) {
            await ctx.runMutation(internal.clickupMutations._unlinkClickUp, {
              taskId,
            });
            // Se recrea con destino por defecto (Mesa Técnica si no eligió
            // otro): el opt-out es el check "solo local" en Hermes, no el
            // borrado manual de la tarea allá.
            const args = mcpTaskArgs(task);
            args.list_id = dest.listId;
            if (dest.parentId) args.parent = dest.parentId;
            const created = await mcpCall("clickup_create_task", args, token);
            const sc2 = mcpStructured(created) ?? {};
            const newId = String(sc2.task_id ?? "");
            if (!newId) throw new Error("create_task no devolvió task_id");
            finalClickupId = newId;
            const newUrl = String(sc2.task_url ?? `https://app.clickup.com/t/${newId}`);
            await ctx.runMutation(internal.clickupMutations._markSynced, {
              taskId,
              clickupId: newId,
              clickupUrl: newUrl,
              clickupListId: dest.listId,
            });
            await syncClickupPath(ctx, taskId, newId);
            await postCompletionNote();
            await ctx.runMutation(internal.clickupMutations._touchLastSync);
            return;
          }
          throw updateErr; // otro error → dejar que el catch de abajo lo maneje
        }
        await ctx.runMutation(internal.clickupMutations._markSynced, {
          taskId,
          clickupId: task.clickupId,
          clickupUrl:
            task.clickupUrl ??
            `https://app.clickup.com/t/${task.clickupId}`,
          clickupListId: dest.listId,
        });
      }

      // UPDATE y CREATE caen acá: si la tarea quedó completada y la hizo el
      // agente, postCompletionNote manda la nota (es idempotente).
      await postCompletionNote();
      await ctx.runMutation(internal.clickupMutations._touchLastSync);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error de sync ClickUp";
      await ctx.runMutation(internal.clickupMutations._markSyncError, {
        taskId,
        error: msg,
      });
      // No relanzar: el error quedó registrado en la tarea. El scheduler de
      // Convex no reintentará, pero el usuario ve el aviso en la UI.
    }
  },
});

// ============================================================
//  INBOUND (ClickUp → Hermes) — sync reversa manual y selectiva
// ============================================================

/** Una tarea nueva detectada en ClickUp (sin mapear en Hermes). */
export interface InboundNewTask {
  clickupId: string;
  name: string;
  status: string;
  /** estado Hermes sugerido por el mapeo inverso (editable en el modal). */
  suggestedStatus: HermesStatus;
  parent: string | null;
  listId: string;
  /** Etiqueta legible del destino ("Ley de Datos · alcance" o "Mesa Técnica"). */
  destinationLabel: string;
}

/** Un cambio de estado detectado en una tarea ya mapeada. */
export interface InboundStatusChange {
  taskId: string; // id interno de Hermes (Id<"tasks">)
  clickupId: string;
  name: string;
  currentStatus: HermesStatus;
  clickupStatus: string;
  /** estado Hermes sugerido por el mapeo inverso (editable en el modal). */
  suggestedStatus: HermesStatus;
}

/** Resultado de un escaneo inbound: las dos secciones del modal. */
export interface InboundDiff {
  newTasks: InboundNewTask[];
  statusChanges: InboundStatusChange[];
}

/**
 * Escanea ClickUp y arma la diff contra las tareas de Hermes:
 *  - newTasks: tareas de ClickUp cuyo id no existe como clickupId en Hermes.
 *  - statusChanges: tareas mapeadas cuyo status de ClickUp difiere del de Hermes.
 *
 * Dos fuentes de escaneo (se combinan y deduplican por clickupId):
 *  1. Lists/proyectos marcados como `inbound` en la config (Mesa Técnica, Ley
 *     de Datos, etc.) — lo que el usuario configuró explícitamente.
 *  2. TODAS las tareas asignadas a Cristian Gutiérrez en el workspace entero
 *     (GET /team/{id}/task?assignees[]=USER_ID), sin importar en qué list/folder
 *     estén. Así, si a Cris le asignan una tarea en cualquier parte, la ve.
 *
 * Ignora las tareas marcadas `clickupInboundIgnored`. Pagina (tope 100/página).
 *
 * Pública (action) con verificación de sesión vía _checkSession, porque las
 * actions no tienen ctx.db para usar requireAuth directamente.
 */
export const getInboundDiff = action({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }): Promise<InboundDiff> => {
    const ok = await ctx.runQuery(internal.settings._checkSession, {
      sessionToken,
    });
    if (!ok) throw new Error("No autorizado: sesión inválida o expirada");

    const configRow = await ctx.runQuery(internal.settings._getRaw, {
      key: SETTINGS_KEY_CONFIG,
    });
    const config = parseClickupConfig(configRow?.value);

    // Tipo interno para tareas recolectadas de ClickUp (de cualquier fuente).
    type ClickupTask = {
      id: string;
      name: string;
      status: string;
      parent: string | null;
      listId: string;
      label: string;
    };
    // Recolectar con deduplicación por id: una misma tarea puede venir tanto de
    // una list trackeada como del escaneo por assignee; nos quedamos con la
    // primera ocurrencia (la label de la list trackeada es más específica).
    const allClickupTasks = new Map<string, ClickupTask>();

    // ===== Fuente 1: lists/proyectos trackeados en la config =====
    type ScanTarget = { listId: string; label: string };
    const targets: ScanTarget[] = [];
    if (config.mesaTecnica.inbound) {
      targets.push({ listId: config.mesaTecnica.listId, label: "Mesa Técnica" });
    }
    for (const proj of config.projects) {
      if (!proj.inbound) continue;
      // Un target por PROYECTO, no por destino: todos los destinos de un
      // proyecto comparten el mismo listId, así que armarlos por destino hacía
      // que se descargara la misma list entera una vez por destino (3 veces
      // para Ley de Datos). El resultado salía igual porque se deduplica por
      // id, pero se gastaban 3× las llamadas contra el límite de ClickUp.
      targets.push({ listId: proj.listId, label: proj.label });
    }
    // Deduplicar por listId: dos proyectos configurados sobre la misma list
    // tampoco tienen por qué escanearla dos veces.
    const seenListIds = new Set<string>();
    const uniqueTargets = targets.filter((t) => {
      if (seenListIds.has(t.listId)) return false;
      seenListIds.add(t.listId);
      return true;
    });
    for (const target of uniqueTargets) {
      {
        const rows = await fetchAllListTasksWithParents(
          ctx,
          target.listId,
        );
        for (const t of rows) {
          if (!allClickupTasks.has(t.id)) {
            allClickupTasks.set(t.id, {
              id: t.id,
              name: t.name,
              status: t.status?.status ?? "to do",
              parent: t.parent ?? null,
              listId: target.listId,
              label: target.label,
            });
          }
        }
        break; // WithParents ya trae TODO (paginado interno)
      }
    }

    // ===== Fuente 2: TODAS las tareas asignadas a Cris en el workspace =====
    // Independientemente de la config trackeada. Si a Cris lo asignan a una
    // tarea en cualquier list/folder, debe aparecer en el modal.
    {
      const assignedRows = await fetchMyAssignedTasks(ctx);
      {
        const tasks: any[] = assignedRows;
        for (const t of tasks) {
          if (!allClickupTasks.has(t.id)) {
            // Label descriptivo: folder/list de ClickUp para contexto.
            const folderName = t.folder?.name;
            const listName = t.list?.name;
            const label = folderName
              ? `${folderName}${listName ? ` · ${listName}` : ""}`
              : listName ?? "Asignada a Cris";
            allClickupTasks.set(t.id, {
              id: t.id,
              name: t.name,
              status: t.status?.status ?? "to do",
              parent: t.parent ?? null,
              listId: t.list?.id ?? "",
              label,
            });
          }
        }
      }
    }

    // Cargar todas las tareas de Hermes con clickupId (para cruzar) y las
    // marcadas como inbound-ignored (para excluirlas de "nuevas").
    const hermesMapped = await ctx.runQuery(
      internal.clickupMutations._listMappedForInbound,
      {},
    );
    const mappedByClickupId = new Map(
      hermesMapped.mapped.map((m) => [m.clickupId, m]),
    );
    const ignoredIds = new Set(hermesMapped.ignoredClickupIds);

    // Excluir el contenedor "Imprevistos Cris" y sus subtasks del inbound: los
    // gestiona el panel Hoy con su propio sync (tabla imprevistos), y su alta
    // rápida haría que cada imprevisto apareciera como "tarea nueva" en el
    // modal a los segundos de cargarlo. Si la feature aún no se usó, la key
    // no existe y esto no excluye nada.
    const imprevistosParentRow = await ctx.runQuery(internal.settings._getRaw, {
      key: SETTINGS_KEY_IMPREVISTOS_PARENT,
    });
    const imprevistosParentId = imprevistosParentRow?.value || null;

    const newTasks: InboundNewTask[] = [];
    const statusChanges: InboundStatusChange[] = [];

    for (const ct of allClickupTasks.values()) {
      // ¿Está ignorada? Saltar (no reaparece como nueva).
      if (ignoredIds.has(ct.id)) continue;
      // ¿Es el padre de imprevistos o una de sus subtasks? Saltar.
      if (
        imprevistosParentId &&
        (ct.id === imprevistosParentId || ct.parent === imprevistosParentId)
      ) {
        continue;
      }

      const hermesTask = mappedByClickupId.get(ct.id);
      if (!hermesTask) {
        // Nueva en ClickUp, no mapeada en Hermes.
        newTasks.push({
          clickupId: ct.id,
          name: ct.name,
          status: ct.status,
          suggestedStatus: mapStatusFromClickUp(ct.status),
          parent: ct.parent,
          listId: ct.listId,
          destinationLabel: ct.label,
        });
      } else {
        // Ya mapeada: ¿cambió el estado?
        const expectedHermes = mapStatusFromClickUp(ct.status);
        if (expectedHermes !== hermesTask.status) {
          statusChanges.push({
            taskId: hermesTask.taskId,
            clickupId: ct.id,
            name: ct.name,
            currentStatus: hermesTask.status,
            clickupStatus: ct.status,
            suggestedStatus: expectedHermes,
          });
        }
      }
    }

    // Registrar timestamp del escaneo inbound.
    await ctx.runMutation(internal.clickupMutations._touchLastInbound, {});

    return { newTasks, statusChanges };
  },
});

/**
 * Aplica los items aprobados del modal de sync reversa. Pública (action) con
 * verificación de sesión. El frontend arma la lista de lo checkeado (con el
 * status final elegido) y lo descartado, y lo envía aquí.
 */
export const submitInbound = action({
  args: {
    sessionToken: v.string(),
    newTasks: v.array(
      v.object({
        clickupId: v.string(),
        name: v.string(),
        status: v.string(), // estado Hermes final elegido en el modal
        parent: v.optional(v.string()),
      }),
    ),
    statusChanges: v.array(
      v.object({
        taskId: v.id("tasks"),
        status: v.string(), // estado Hermes final elegido en el modal
      }),
    ),
    /** clickupIds a marcar como ignorados (descartados en el modal). */
    ignoreClickupIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const ok = await ctx.runQuery(internal.settings._checkSession, {
      sessionToken: args.sessionToken,
    });
    if (!ok) throw new Error("No autorizado: sesión inválida o expirada");

    // 1) Crear las tareas nuevas aprobadas.
    for (const nt of args.newTasks) {
      await ctx.runMutation(internal.clickupMutations._createInboundTask, {
        title: nt.name,
        clickupId: nt.clickupId,
        clickupParentId: nt.parent ?? undefined,
        status: nt.status as HermesStatus,
      });
    }

    // 2) Aplicar los cambios de estado aprobados.
    for (const sc of args.statusChanges) {
      await ctx.runMutation(internal.clickupMutations._applyInboundStatus, {
        taskId: sc.taskId,
        status: sc.status as HermesStatus,
      });
    }

    // 3) Marcar como ignoradas las descartadas.
    for (const clickupId of args.ignoreClickupIds) {
      await ctx.runMutation(internal.clickupMutations._ignoreInbound, {
        clickupId,
      });
    }

    return {
      created: args.newTasks.length,
      updated: args.statusChanges.length,
      ignored: args.ignoreClickupIds.length,
    };
  },
});

// ============================================================
//  DESCUBRIMIENTO DE PROYECTOS (folders donde Cris tiene tareas)
// ============================================================

/** Un destino sugerido para un proyecto descubierto. */
export interface SuggestedDestination {
  label: string;
  parentId: string | null;
}

/** Un proyecto descubierto en ClickUp (folder con tareas de Cris). */
export interface DiscoveredProject {
  folderId: string;
  folderName: string;
  listId: string;
  listName: string;
  /** Todas las lists del folder (para selector multi-list como CatchUp). */
  lists: { id: string; name: string }[];
  taskCount: number;
  /** Destinos candidatos detectados por heurística (editables en la UI). */
  suggestedDestinations: SuggestedDestination[];
  /** true si ya está en config.projects (por listId). */
  alreadyIntegrated: boolean;
}

/**
 * Descubre todos los folders de ClickUp donde Cristian tiene tareas asignadas,
 * con destinos sugeridos por heurística. Sirve para integrar proyectos nuevos
 * al config trackeado desde el panel ⚙️.
 *
 * Pública (action) con verificación de sesión.
 */
export const discoverProjects = action({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }): Promise<{
    discovered: DiscoveredProject[];
  }> => {
    const ok = await ctx.runQuery(internal.settings._checkSession, {
      sessionToken,
    });
    if (!ok) throw new Error("No autorizado: sesión inválida o expirada");

    // Config actual para marcar alreadyIntegrated.
    const configRow = await ctx.runQuery(internal.settings._getRaw, {
      key: SETTINGS_KEY_CONFIG,
    });
    const config = parseClickupConfig(configRow?.value);
    const integratedListIds = new Set(config.projects.map((p) => p.listId));

    // 1) Traer TODOS los folders del space con sus lists embebidas.
    //    Esto lista la estructura completa del workspace, sin depender de si
    //    Cris tiene tareas asignadas o no. Así el usuario puede integrar
    //    cualquier proyecto/list para crear tareas ahí.
    const folders: any[] = await mcpSpaceFolders(ctx);

    const discovered: DiscoveredProject[] = [];
    // Folders en el orden de ClickUp.
    for (const folder of sortByClickUpOrder([...folders])) {
      const folderId: string = folder.id;
      const folderName: string = folder.name ?? "Sin nombre";
      // Lists dentro del folder (ClickUp las embebe en el response), también
      // en el orden de ClickUp.
      const folderLists: { id: string; name: string }[] = sortByClickUpOrder(
        (folder.lists ?? []).filter((l: any) => !l.archived),
      ).map((l: any) => ({ id: l.id, name: l.name }));
      // Si el folder no tiene lists propias (es contenedor), lo saltamos: no es
      // un destino válido para crear tareas.
      if (folderLists.length === 0) continue;

      const listId = folderLists[0]?.id ?? "";
      const listName = folderLists[0]?.name ?? "";

      discovered.push({
        folderId,
        folderName,
        listId,
        listName,
        lists: folderLists,
        taskCount: 0, // No relevante ahora: listamos por estructura, no por tareas.
        suggestedDestinations: [{ label: "Tareas generales", parentId: null }],
        alreadyIntegrated: integratedListIds.has(listId),
      });
    }

    // Se respeta el orden de ClickUp: antes se reordenaba alfabéticamente
    // (no integrados primero), lo que hacía que el selector no coincidiera con
    // lo que el usuario ve en ClickUp — y que "Administrativo" quedara siempre
    // arriba de todo.
    return { discovered };
  },
});

// ============================================================
//  SELECTORES DINÁMICOS (lists de un folder + raíces de una list)
// ============================================================

/** Una list de ClickUp dentro de un folder. */
export interface ClickupFolderList {
  id: string;
  name: string;
}

/**
 * Lista las lists de un folder de ClickUp (ej. CatchUp → Cris, Cesar).
 * Sirve para que el selector de destino ofrezca elegir en qué list cae la
 * tarea cuando un folder tiene varias. Pública (action) con auth.
 */
export const listFolderLists = action({
  args: { sessionToken: v.string(), folderId: v.string() },
  handler: async (ctx, { sessionToken, folderId }): Promise<{
    lists: ClickupFolderList[];
  }> => {
    const ok = await ctx.runQuery(internal.settings._checkSession, {
      sessionToken,
    });
    if (!ok) throw new Error("No autorizado: sesión inválida o expirada");
    const allFolders = await mcpSpaceFolders(ctx);
    const folder = allFolders.find((f) => f.id === folderId);
    return {
      lists: (folder?.lists ?? []).map((l) => ({ id: l.id, name: l.name })),
    };
  },
});

/** Una tarea-raíz de una list (para anidar bajo ella). */
export interface ClickupRootTask {
  id: string;
  name: string;
  status: string;
}

/**
 * Trae las tareas-raíz (sin parent) de una list de ClickUp en vivo. Sirve para
 * el selector dinámico de destino: por ejemplo, las fechas de CatchUp
 * ([CatchUp]-21.07.26) que cambian con el tiempo. Pública (action) con auth.
 */
export const listProjectRoots = action({
  args: { sessionToken: v.string(), listId: v.string() },
  handler: async (
    ctx,
    { sessionToken, listId },
  ): Promise<{ roots: ClickupRootTask[] }> => {
    const ok = await ctx.runQuery(internal.settings._checkSession, {
      sessionToken,
    });
    if (!ok) throw new Error("No autorizado: sesión inválida o expirada");
    const token = await requireMcpToken(ctx);
    const rawRoots: any[] = [];
    let page = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // MCP: subtasks=false ⇒ sólo raíces (ClickUp excluye a TODAS las
      // descendientes de una list cuando el flag está en false).
      const sc: any =
        mcpStructured(
          await mcpCall(
            "clickup_filter_tasks",
            { list_ids: [listId], include_closed: false, subtasks: false, page },
            token,
          ),
        ) ?? {};
      const tasks: any[] = sc.tasks ?? [];
      if (tasks.length === 0) break;
      for (const t of tasks) rawRoots.push(normalizeMcpTaskRow(t));
      const next = sc.next_page;
      if (!sc.has_more || typeof next !== "number" || next <= page) break;
      page++;
    }
    // Mismo orden que en ClickUp.
    const roots: ClickupRootTask[] = sortByClickUpOrder(rawRoots).map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status?.status ?? "to do",
    }));
    return { roots };
  },
});

// ============================================================
//  NAVEGACIÓN DE ÁRBOL (hijas de un nodo + crear raíces)
// ============================================================

/** Una tarea hija en el navegador de árbol. */
export interface ClickupTreeNode {
  id: string;
  name: string;
  status: string;
}

/**
 * Trae las hijas directas de una tarea de ClickUp (para expandir un nodo del
 * navegador de árbol on-demand). Usa `GET /list/{listId}/task?parent={parentId}`
 * y filtra client-side por `t.parent === parentId` para blindarse contra la
 * anomalía de la API (cuando un nodo no tiene hijas, a veces devuelve hijas de
 * otro padre).
 *
 * Pública (action) con auth.
 */
export const listTaskChildren = action({
  args: {
    sessionToken: v.string(),
    listId: v.string(),
    parentId: v.string(),
  },
  handler: async (
    ctx,
    { sessionToken, listId, parentId },
  ): Promise<{ children: ClickupTreeNode[] }> => {
    const ok = await ctx.runQuery(internal.settings._checkSession, {
      sessionToken,
    });
    if (!ok) throw new Error("No autorizado: sesión inválida o expirada");
    void listId; // la herramienta MCP navega por parentId, la list sobra aquí
    const rawChildren: any[] = [];
    // get_task(include:["subtasks"]) devuelve DIRECTAMENTE las hijas del nodo.
    const parent = await mcpGetTaskLegacy(ctx, parentId, ["subtasks"]);
    for (const sub of parent.subtasks ?? []) {
      rawChildren.push({ ...sub, parent: parentId });
    }
    // Mismo orden que en ClickUp.
    const children: ClickupTreeNode[] = sortByClickUpOrder(rawChildren).map(
      (t) => ({
        id: t.id,
        name: t.name,
        status: t.status?.status ?? "to do",
      }),
    );
    return { children };
  },
});

/**
 * Crea una tarea raíz (sin parent) en una list de ClickUp. Sirve para crear
 * nuevos nodos de nivel 0 desde Hermes (ej. un CatchUp con otra fecha).
 * Respeta el guard de dev (forceSyncDev): en dev solo crea si el override está
 * activo, para no ensuciar ClickUp compartido.
 *
 * Pública (action) con auth. Devuelve `{ id, name, url }`.
 */
export const createRootTask = action({
  args: {
    sessionToken: v.string(),
    listId: v.string(),
    name: v.string(),
    status: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { sessionToken, listId, name, status },
  ): Promise<{ id: string; name: string; url: string }> => {
    const ok = await ctx.runQuery(internal.settings._checkSession, {
      sessionToken,
    });
    if (!ok) throw new Error("No autorizado: sesión inválida o expirada");

    // Guard de entorno: en dev, solo crear si el override forceSyncDev está on.
    if (!isProductionDeployment()) {
      const forceRow = await ctx.runQuery(internal.settings._getRaw, {
        key: SETTINGS_KEY_FORCE_SYNC_DEV,
      });
      if (forceRow?.value !== "true") {
        throw new Error(
          "Creación desactivada en dev. Activá 'Forzar sync en dev' en el panel ⚙️.",
        );
      }
    }

    const token = await requireMcpToken(ctx);
    const created = await mcpCall(
      "clickup_create_task",
      { name, list_id: listId, status: status ?? "to do", assignees: [CLICKUP_USER_ID] },
      token,
    );
    const sc: any = mcpStructured(created) ?? {};
    const id = String(sc.task_id ?? "");
    if (!id) throw new Error("create_task no devolvió task_id");
    const url = String(sc.task_url ?? `https://app.clickup.com/t/${id}`);
    return { id, name, url };
  },
});

// ============================================================
//  PÁGINA DE SINCRONIZACIÓN: explorador del workspace + suscripciones
// ============================================================

/** Una tarea raíz dentro del árbol del workspace. */
export interface WorkspaceTask {
  id: string;
  name: string;
  status: string;
  /** Primer nombre del responsable (primer assignee), si lo hay. */
  assignee?: string;
  /** Subtareas directas, ya anidadas (a cualquier profundidad). */
  children: WorkspaceTask[];
}

/** Una list dentro del árbol (tareas raíz, cada una con su subárbol). */
export interface WorkspaceList {
  id: string;
  name: string;
  tasks: WorkspaceTask[];
}

/** Un folder dentro del árbol (con sus lists). */
export interface WorkspaceFolder {
  id: string;
  name: string;
  lists: WorkspaceList[];
}

/** Árbol completo del workspace para la página de sincronización. */
export interface WorkspaceTree {
  folders: WorkspaceFolder[];
}

/**
 * Trae TODA la estructura del space: folders → lists → tareas → subtareas, ya
 * anidadas y a cualquier profundidad.
 *
 * Antes traía solo las tareas raíz y el resto se cargaba on-demand por nodo.
 * Eso hacía imposible saber, al abrir la página, dónde vive cada suscripción
 * sin ir pidiéndolas una por una. Como ClickUp devuelve las subtareas en la
 * MISMA llamada por list (`subtasks=true`), armar el árbol completo no cuesta
 * llamadas extra: antes se descargaban y se tiraban.
 *
 * Pública (action) con auth.
 */
// ============================================================
//  Orden de ClickUp
// ============================================================
/**
 * `orderindex` es el campo con el que ClickUp ordena manualmente folders,
 * lists y tareas dentro de su padre: es el orden que ve el usuario en la app.
 * Viene como número o como string decimal según el endpoint, y puede faltar.
 *
 * Ordenar por él es lo que hace que el árbol de Hermes se lea igual que
 * ClickUp (FASE 1, FASE 2, FASE 3…) en vez del orden arbitrario en que la API
 * devuelve las tareas.
 */
function orderIndexOf(x: any): number {
  const raw = x?.orderindex;
  // Ojo: Number(null) y Number("") son 0, no NaN. Sin este chequeo, un nodo
  // sin orderindex se iba al TOPE de la lista en vez de al final.
  if (raw === null || raw === undefined || raw === "") {
    return Number.MAX_SAFE_INTEGER;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/** Ordena in-place por orderindex ascendente (estable: empates conservan orden). */
function sortByClickUpOrder<T>(items: T[]): T[] {
  return items.sort((a, b) => orderIndexOf(a) - orderIndexOf(b));
}

/** Trae TODAS las tareas de una list (con subtareas), paginando. */
async function fetchAllListTasks(
  ctx: unknown,
  listId: string,
  folder?: { id?: string; name?: string },
): Promise<any[]> {
  return fetchAllListTasksWithParents(ctx, listId, folder);
}

/**
 * Trae las tareas del workspace ASIGNADAS a Cris, filtrando del lado de
 * ClickUp. Devuelve mucho menos que escanear el space entero y es la base de
 * la bandeja: se usa para saber QUÉ listas hay que mirar en detalle.
 */
async function fetchMyAssignedTasks(ctx: unknown): Promise<any[]> {
  const token = await requireMcpToken(ctx);
  const all: any[] = [];
  let page = 0;
  let idx = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const sc: any =
      mcpStructured(
        await mcpCall(
          "clickup_filter_tasks",
          {
            assignees: [CLICKUP_USER_ID],
            space_ids: [CLICKUP_SPACE_ID],
            subtasks: true,
            include_closed: false,
            page,
          },
          token,
        ),
      ) ?? {};
    for (const t of sc.tasks ?? [])
      all.push(normalizeMcpTaskRow(t, {}, idx++));
    const next = sc.next_page;
    if (!sc.has_more || typeof next !== "number" || next <= page) break;
    page = next;
  }
  return all;
}
export const getWorkspaceTree = action({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }): Promise<WorkspaceTree> => {
    const ok = await ctx.runQuery(internal.settings._checkSession, {
      sessionToken,
    });
    if (!ok) throw new Error("No autorizado: sesión inválida o expirada");

    // Folders del space (vienen con sus lists embebidas).
    const foldersRaw: any[] = await mcpSpaceFolders(ctx);

    const folders: WorkspaceFolder[] = [];
    // Paralelizar: recolectar todas las lists de todos los folders, lanzar
    // todos los fetches de tareas a la vez, y luego ensamblar el árbol.
    const allListFetches: {
      folderIdx: number;
      listId: string;
      listName: string;
      promise: Promise<any>;
    }[] = [];
    // Folders y lists también en el orden de ClickUp.
    const folderData = sortByClickUpOrder([...foldersRaw])
      .map((folder) => ({
        id: folder.id,
        name: folder.name ?? "Sin nombre",
        lists: sortByClickUpOrder(
          (folder.lists ?? []).filter((l: any) => !l.archived),
        ),
      }))
      .filter((f: any) => f.lists.length > 0);

    folderData.forEach((folder: any, folderIdx: number) => {
      for (const list of folder.lists) {
        allListFetches.push({
          folderIdx,
          listId: list.id,
          listName: list.name,
          promise: fetchAllListTasks(ctx, list.id).catch(() => null),
        });
      }
    });

    // Resolver todos los fetches en paralelo.
    const results = await Promise.all(allListFetches.map((f) => f.promise));

    // Ensablar por folder.
    const foldersByLists = new Map<number, WorkspaceList[]>();
    allListFetches.forEach((fetchInfo, i) => {
      // Mismo orden que en ClickUp. Al recorrer el array ya ordenado, tanto
      // las raíces como las hijas quedan en ese orden dentro de su padre.
      const raw: any[] = sortByClickUpOrder([...(results[i] ?? [])]);

      // 1) Indexar todas las tareas de la list por id.
      const byId = new Map<string, WorkspaceTask>();
      for (const t of raw) {
        if (!t?.id) continue;
        // Primer nombre del primer assignee (ej. "Cristian Gutiérrez" → "Cristian").
        const assigneeUser = t.assignees?.[0]?.username as string | undefined;
        byId.set(t.id, {
          id: t.id,
          name: t.name ?? "(sin nombre)",
          status: t.status?.status ?? "to do",
          assignee: assigneeUser ? assigneeUser.split(" ")[0] : undefined,
          children: [],
        });
      }

      // 2) Colgar cada una de su padre. Si el padre no está en esta list
      //    (subtarea cross-list, o quedó fuera del tope de páginas), la
      //    tratamos como raíz para que no desaparezca del árbol.
      const tasks: WorkspaceTask[] = [];
      for (const t of raw) {
        const node = byId.get(t?.id);
        if (!node) continue;
        const parent = t.parent ? byId.get(t.parent) : undefined;
        if (parent) parent.children.push(node);
        else tasks.push(node);
      }

      const list: WorkspaceList = { id: fetchInfo.listId, name: fetchInfo.listName, tasks };
      const existing = foldersByLists.get(fetchInfo.folderIdx) ?? [];
      existing.push(list);
      foldersByLists.set(fetchInfo.folderIdx, existing);
    });

    for (let i = 0; i < folderData.length; i++) {
      const folder = folderData[i];
      folders.push({
        id: folder.id,
        name: folder.name,
        lists: foldersByLists.get(i) ?? [],
      });
    }

    return { folders };
  },
});

/**
 * Aplica cambios de suscripción: añade/quita nodos suscriptos en settings y,
 * para los nodos añadidos, dispara el importe inmediato de sus tareas actuales
 * a Hermes (las que no existan ya por clickupId).
 *
 * Pública (action) con auth.
 */
export const applySubscriptions = action({
  args: {
    sessionToken: v.string(),
    /** Nodos a añadir (suscribir). */
    add: v.array(
      v.object({
        nodeType: v.union(
          v.literal("folder"),
          v.literal("list"),
          v.literal("task"),
        ),
        id: v.string(),
        label: v.string(),
      }),
    ),
    /** ids de nodos a quitar (desuscribir). */
    remove: v.array(v.string()),
  },
  handler: async (ctx, { sessionToken, add, remove }) => {
    const ok = await ctx.runQuery(internal.settings._checkSession, {
      sessionToken,
    });
    if (!ok) throw new Error("No autorizado: sesión inválida o expirada");

    // 1) Actualizar suscripciones en settings.
    await ctx.runMutation(internal.settings._setSubscriptions, {
      add,
      removeIds: remove,
    });

    // 2) Para los nodos añadidos, recopilar todas sus tareas e importar las nuevas.
    const allClickupTaskIds = new Set<string>();
    const tasksToImport: {
      id: string;
      name: string;
      status: string;
      parent: string | null;
      dueDate?: string;
      description?: string;
      timeEstimateMs?: number;
      assignees?: number[];
      assigneeName?: string;
      folderName?: string;
      folderId?: string;
      listName?: string;
      listId?: string;
    }[] = [];
    /** Nodos que se suscribieron pero cuyo detalle no se pudo traer. */
    const failed: { id: string; label: string; error: string }[] = [];

    for (const node of add) {
      if (node.nodeType === "task") {
        // Tarea individual: traer su detalle.
        try {
          const t = await mcpGetTaskLegacy(ctx, node.id);
          allClickupTaskIds.add(t.id);
          tasksToImport.push({
            id: t.id,
            name: t.name,
            status: t.status?.status ?? "to do",
            parent: t.parent ?? null,
            dueDate: t.due_date ? new Date(Number(t.due_date)).toISOString().slice(0, 10) : undefined,
            description: t.description || undefined,
            timeEstimateMs: t.time_estimate ? Number(t.time_estimate) : undefined,
            assignees: (t.assignees ?? []).map((a: any) => Number(a.id)),
            assigneeName: t.assignees?.[0]?.username
              ? String(t.assignees[0].username).split(" ")[0]
              : undefined,
            // folder/list vienen en la misma respuesta: cero llamadas extra.
            folderName: t.folder?.hidden ? undefined : t.folder?.name,
            folderId: t.folder?.hidden ? undefined : t.folder?.id,
            listId: t.list?.id,
            listName: t.list?.name,
          });
        } catch (err) {
          // La tarea no se pudo traer (borrada, sin permisos, rate limit).
          // NO se puede ignorar en silencio: la suscripción ya quedó
          // persistida arriba, así que el usuario vería el check de
          // "suscripto" sin que la tarea llegue nunca al tablero. Se reporta
          // para que el caller lo muestre.
          failed.push({
            id: node.id,
            label: node.label,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        // folder o list: traer todas las tareas (con subtareas).
        let listIds: { id: string }[] = [];
        if (node.nodeType === "folder") {
          const allFolders = await mcpSpaceFolders(ctx);
          const target = allFolders.find((f: any) => f.id === node.id);
          for (const l of target?.lists ?? []) listIds.push({ id: l.id });
        } else {
          listIds.push({ id: node.id });
        }
        for (const { id: listId } of listIds) {
          {
            const tasks: any[] = await fetchAllListTasksWithParents(
              ctx,
              listId,
              node.nodeType === "folder"
                ? { id: node.id, name: node.label }
                : undefined,
            );
            for (const t of tasks) {
              allClickupTaskIds.add(t.id);
              tasksToImport.push({
                id: t.id,
                name: t.name,
                status: t.status?.status ?? "to do",
                parent: t.parent ?? null,
                dueDate: t.due_date ? new Date(Number(t.due_date)).toISOString().slice(0, 10) : undefined,
                description: t.description || undefined,
                timeEstimateMs: t.time_estimate ? Number(t.time_estimate) : undefined,
                assignees: (t.assignees ?? []).map((a: any) => Number(a.id)),
                assigneeName: t.assignees?.[0]?.username
                  ? String(t.assignees[0].username).split(" ")[0]
                  : undefined,
                // Ubicación para agrupar el tablero: viene en la misma
                // respuesta, sin llamadas extra. Faltaba en esta rama (alta
                // por folder/list), así que esas tareas entraban sin proyecto.
                folderName: t.folder?.hidden ? undefined : t.folder?.name,
                folderId: t.folder?.hidden ? undefined : t.folder?.id,
                listId: t.list?.id,
                listName: t.list?.name,
              });
            }
          }
        }
      }
    }

    // 3) Para cada tarea a importar: crear si no existe, o restaurar si fue
    //    soft-deleted/ignorada al desuscribirse antes.
    const existing = await ctx.runQuery(
      internal.clickupMutations._listMappedForInbound,
      {},
    );
    // Construir Map en memoria desde el array plano (Convex no devuelve Maps).
    const allById = new Map(
      existing.allEntries.map((e) => [e.clickupId, e]),
    );
    let imported = 0;
    let restored = 0;
    for (const task of tasksToImport) {
      const existingInfo = allById.get(task.id);
      if (!existingInfo) {
        // No existe → crear.
        const status = mapStatusFromClickUp(task.status);
        await ctx.runMutation(internal.clickupMutations._createInboundTask, {
          title: task.name,
          clickupId: task.id,
          clickupParentId: task.parent ?? undefined,
          status,
          dueDate: task.dueDate,
          notes: task.description,
          timeEstimateMs: task.timeEstimateMs,
          isAssignedToCris: task.assignees?.includes(Number(CLICKUP_USER_ID)) ?? false,
          assigneeName: task.assigneeName,
          // Ubicación para agrupar el tablero. Los ancestros los completa el
          // backfill: acá solo tenemos el padre directo, no la cadena.
          clickupPath:
            task.listId || task.listName || task.folderName
              ? {
                  listId: task.listId,
                  folderId: task.folderId,
                  folderName: task.folderName,
                  listName: task.listName,
                  resolvedAt: Date.now(),
                }
              : undefined,
        });
        imported++;
      } else if (existingInfo.deleted || existingInfo.ignored) {
        // Existe pero está borrada/ignorada → restaurar.
        await ctx.runMutation(internal.clickupMutations._restoreInboundTask, {
          taskId: existingInfo.taskId,
        });
        restored++;
      }
      // else: ya existe y está activa → no hacer nada.
    }

    // 4) Marcar como ignoradas (soft-delete) las ids en `remove` que sean tareas
    //    ya importadas. Las que eran suscripciones ya se quitaron en paso 1.
    let ignored = 0;
    for (const id of remove) {
      const info = allById.get(id);
      if (info && !info.deleted) {
        await ctx.runMutation(internal.clickupMutations._ignoreInbound, {
          clickupId: id,
        });
        ignored++;
      }
    }

    return {
      subscriptionsAdded: add.length,
      subscriptionsRemoved: remove.length,
      tasksImported: imported,
      tasksRestored: restored,
      tasksSkipped: tasksToImport.length - imported - restored,
      tasksIgnored: ignored,
      /** Nodos suscriptos cuyo detalle no se pudo traer de ClickUp. */
      failed,
    };
  },
});

/**
 * Re-sincroniza el responsable de las tareas ya importadas. Para cada tarea con
 * clickupId, trae el assignee real de ClickUp y corrije executor/clickupAssignee.
 * Sirve para migrar tareas importadas antes del fix que forzaba executor=claw.
 *
 * Pública (action) con auth.
 */
export const syncAssignees = action({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const ok = await ctx.runQuery(internal.settings._checkSession, {
      sessionToken,
    });
    if (!ok) throw new Error("No autorizado: sesión inválida o expirada");

    // Traer todas las tareas importadas con clickupId.
    const existing = await ctx.runQuery(
      internal.clickupMutations._listMappedForInbound,
      {},
    );
    let fixed = 0;
    const failed: { clickupId: string; error: string }[] = [];
    for (const entry of existing.allEntries) {
      if (entry.deleted) continue;
      try {
        const t = await mcpGetTaskLegacy(ctx, entry.clickupId);
        const assigneeName = t.assignees?.[0]?.username
          ? String(t.assignees[0].username).split(" ")[0]
          : undefined;
        const isAssignedToCris = (t.assignees ?? []).some(
          (a: any) => Number(a.id) === Number(CLICKUP_USER_ID),
        );
        await ctx.runMutation(internal.clickupMutations._updateAssignee, {
          taskId: entry.taskId,
          // `executor` es de Hermes (Cris o Claw) y lo elige el usuario;
          // `clickupAssignee` es el responsable real en ClickUp. Antes esta
          // función forzaba executor según ClickUp sobre TODAS las tareas: un
          // click borraba cualquier asignación manual a Claw (undefined en un
          // patch de Convex BORRA el campo). Ahora solo se sugiere `cris`
          // cuando la tarea es mía y no hay executor puesto; nunca se pisa una
          // elección existente.
          executor: isAssignedToCris ? "cris" : undefined,
          // El nombre de ClickUp sí es dato de ClickUp: se refresca siempre.
          clickupAssignee: assigneeName,
          preserveExistingExecutor: true,
        });
        fixed++;
      } catch (err) {
        // Antes se descartaba en silencio: el usuario veía "N actualizados"
        // sin enterarse de que otras M fallaron ni por qué.
        failed.push({
          clickupId: entry.clickupId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { fixed, failed };
  },
});

/**
 * Dado un clickupId (tarea), devuelve su listId y folderId. Sirve para que el
 * picker de destino pueda auto-seleccionar el folder correcto al abrir una
 * tarea existente, incluso si no tiene clickupListId persistido (tareas viejas).
 *
 * Pública (action) con auth.
 */
export const resolveTaskList = action({
  args: { sessionToken: v.string(), clickupId: v.string() },
  handler: async (ctx, { sessionToken, clickupId }): Promise<{
    listId: string | null;
    folderId: string | null;
  }> => {
    const ok = await ctx.runQuery(internal.settings._checkSession, {
      sessionToken,
    });
    if (!ok) throw new Error("No autorizado: sesión inválida o expirada");
    try {
      const t = await mcpGetTaskLegacy(ctx, clickupId);
      return {
        listId: t.list?.id ?? null,
        folderId: t.folder && !t.folder.hidden ? (t.folder.id ?? null) : null,
      };
    } catch {
      return { listId: null, folderId: null };
    }
  },
});

/** Un nodo de la ruta jerárquica de ClickUp (de la raíz hacia abajo). */
export interface ClickupPathNode {
  id: string;
  name: string;
}

/**
 * Dado el clickupId de un nodo, devuelve su ubicación COMPLETA: list, folder y
 * la cadena de ancestros desde la raíz hasta el nodo inclusive.
 *
 * Sirve para que, al reabrir una tarea, el picker reconstruya exactamente
 * dónde vive: folder → list → raíz → … → nodo padre, con el árbol ya expandido
 * en esa rama. Sin esto el navegador solo mostraba las raíces y el destino real
 * quedaba invisible varios niveles más abajo.
 *
 * Sube por `parent` de a un nivel (la API de ClickUp no expone la cadena
 * completa en una sola llamada). Tope de 12 saltos por seguridad: la jerarquía
 * real nunca es tan profunda y así un ciclo corrupto no cuelga la acción.
 *
 * Pública (action) con auth. Nunca lanza: ante un fallo devuelve lo que haya
 * podido resolver, porque es información de conveniencia para la UI.
 */
/**
 * Sube por la cadena de `parent` hasta la raíz y devuelve la ubicación
 * completa de un nodo. Extraído de la action para poder reusarlo desde el
 * backfill sin pagar un round-trip de Convex por tarea.
 *
 * Nunca lanza por un nodo faltante: devuelve lo que haya podido resolver.
 * Tope de 12 saltos + set de vistos: un ciclo corrupto no cuelga la acción.
 */
async function resolveTaskPathInternal(ctx: unknown, clickupId: string): Promise<{
  listId: string | null;
  listName: string | null;
  folderId: string | null;
  folderName: string | null;
  path: ClickupPathNode[];
}> {
  const path: ClickupPathNode[] = [];
  let listId: string | null = null;
  let listName: string | null = null;
  let folderId: string | null = null;
  let folderName: string | null = null;

  const token = await requireMcpToken(ctx);
  let currentId: string | null = clickupId;
  const seen = new Set<string>();
  for (let hop = 0; currentId && hop < 12; hop++) {
    if (seen.has(currentId)) break; // ciclo defensivo
    seen.add(currentId);
    let result: any;
    try {
      result = await mcpCall(
        "clickup_get_task",
        { task_id: currentId },
        token,
      );
    } catch {
      break; // el nodo ya no existe en ClickUp: devolvemos lo resuelto
    }
    const t: any = mcpStructured(result);
    if (!t?.id) break;
    if (hop === 0) {
      listId = t.list?.id ?? null;
      listName = t.list?.name ?? null;
      // La tool MCP expone folder directo (sin flag hidden visible); si
      // viene vacío asumimos list suelta del space.
      folderId = t.folder?.id ?? null;
      folderName = t.folder?.name ?? null;
    }
    path.unshift({ id: t.id, name: t.name ?? "(sin nombre)" });
    const parent = t.parent;
    currentId =
      typeof parent === "string"
        ? parent
        : typeof parent === "object" && parent?.id
          ? String(parent.id)
          : null;
  }

  return { listId, listName, folderId, folderName, path };
}

/**
 * Resuelve contra ClickUp dónde vive la tarea y persiste su `clickupPath`.
 *
 * Se invoca al crear/anclar una tarea desde el sync para que la agrupación
 * por proyecto la ubique de inmediato: antes la ruta solo la llenaba el
 * backfill manual («Recalcular ubicaciones»), así que una tarea recién
 * linkeada a un proyecto seguía apareciendo en «Sueltas» hasta que alguien
 * corriera ese recálculo.
 *
 * Falla silenciosa: la ruta es información de conveniencia para agrupar; un
 * fallo acá no debe marcar la tarea con error de sync (sin ruta, la tarea
 * cae en «Sueltas» hasta el próximo recálculo manual).
 */
async function syncClickupPath(ctx: any, taskId: any, clickupId: string) {
  try {
    const info = await resolveTaskPathInternal(ctx, clickupId);
    // El último nodo de la cadena es la tarea misma: no es un ancestro.
    const ancestors = info.path.slice(0, -1).map((n) => n.name);
    await ctx.runMutation(internal.clickupMutations._setClickupPath, {
      taskId,
      clickupPath: {
        folderName: info.folderName ?? undefined,
        listName: info.listName ?? undefined,
        listId: info.listId ?? undefined,
        folderId: info.folderId ?? undefined,
        ancestors,
        resolvedAt: Date.now(),
      },
    });
  } catch {
    // Sin ruta la tarea queda en «Sueltas» hasta el próximo recálculo.
  }
}

export const resolveTaskPath = action({
  args: { sessionToken: v.string(), clickupId: v.string() },
  handler: async (
    ctx,
    { sessionToken, clickupId },
  ): Promise<{
    listId: string | null;
    listName: string | null;
    folderId: string | null;
    folderName: string | null;
    /** Ancestros de la RAÍZ hacia abajo, incluyendo el nodo consultado. */
    path: ClickupPathNode[];
  }> => {
    const ok = await ctx.runQuery(internal.settings._checkSession, {
      sessionToken,
    });
    if (!ok) throw new Error("No autorizado: sesión inválida o expirada");

    return await resolveTaskPathInternal(ctx, clickupId);
  },
});

// ============================================================
//  BANDEJA: tareas asignadas a mí que no estoy trackeando
// ============================================================

/** Una tarea de ClickUp asignada a Cris que todavía no está en el Kanban. */
export interface AssignedUntrackedTask {
  id: string;
  name: string;
  status: string;
  /** Folder y list donde vive. */
  folderId: string;
  folderName: string;
  listName: string;
  listId: string;
  /**
   * Ancestros dentro de la list, de la raíz hacia abajo (sin la tarea).
   * Con id además del nombre: la bandeja agrupa por id, porque dos ramas
   * distintas pueden tener nodos con el mismo nombre.
   */
  ancestors: { id: string; name: string }[];
  /** Id del padre directo, o null si es una tarea raíz de la list. */
  parentId: string | null;
  /** Fecha de vencimiento (YYYY-MM-DD) si tiene. */
  dueDate?: string;
}

/**
 * Lista las tareas de ClickUp ASIGNADAS a Cris que NO están en el Kanban.
 *
 * Solo devuelve HOJAS: una tarea con subtareas es un contenedor (un proyecto o
 * una fase), y traerla al tablero arrastraría todo su árbol conceptualmente sin
 * ser una unidad de trabajo. El filtro de hojas se calcula sobre TODAS las
 * tareas de la list (no solo las asignadas), porque si no una fase con
 * subtareas ajenas parecería una hoja.
 *
 * Se excluyen las ya importadas y también las descartadas explícitamente
 * (clickupInboundIgnored): si el usuario ya dijo que no la quiere, no se la
 * volvemos a ofrecer.
 *
 * Pública (action) con auth.
 */
export const listAssignedUntracked = action({
  args: { sessionToken: v.string() },
  handler: async (
    ctx,
    { sessionToken },
  ): Promise<{ tasks: AssignedUntrackedTask[]; scanned: number }> => {
    const ok = await ctx.runQuery(internal.settings._checkSession, {
      sessionToken,
    });
    if (!ok) throw new Error("No autorizado: sesión inválida o expirada");

    // 1) Qué hay ya en Hermes (incluye borradas/ignoradas: no reofrecerlas)
    //    y las tareas asignadas a mí. En paralelo: no dependen entre sí.
    const [existing, mine] = await Promise.all([
      ctx.runQuery(internal.clickupMutations._listMappedForInbound, {}),
      fetchMyAssignedTasks(ctx),
    ]);
    const known = new Set(existing.allEntries.map((e) => e.clickupId));

    // 2) Solo interesan las listas donde tengo algo sin trackear. Antes se
    //    escaneaba el space ENTERO (todas las listas, todas sus tareas), que
    //    es lo que hacía lenta la bandeja y disparaba el rate limit de
    //    ClickUp. Ahora ClickUp filtra por assignee y nosotros bajamos al
    //    detalle únicamente de esas listas.
    const relevantListIds = new Set<string>();
    for (const t of mine) {
      if (known.has(t.id)) continue;
      const lid = t.list?.id;
      if (lid) relevantListIds.add(String(lid));
    }
    if (relevantListIds.size === 0) return { tasks: [], scanned: mine.length };

    // 3) Estructura del space (MCP), para nombres de folder/list y su orden.
    const folderData = (await mcpSpaceFolders(ctx))
      .map((folder: any) => ({
        id: folder.id,
        name: folder.name ?? "Sin nombre",
        lists: folder.lists.filter(
          (l: any) => relevantListIds.has(String(l.id)),
        ),
      }))
      .filter((f: any) => f.lists.length > 0);

    const fetches: {
      folderId: string;
      folderName: string;
      listId: string;
      listName: string;
      promise: Promise<any>;
    }[] = [];
    for (const folder of folderData) {
      for (const list of folder.lists as any[]) {
        fetches.push({
          folderId: folder.id,
          folderName: folder.name,
          listId: list.id,
          listName: list.name,
          // Se necesitan TODAS las tareas de estas listas (no solo las mías):
          // sin ellas no se puede saber si una tarea tiene subtareas ajenas
          // (o sea, si es contenedor) ni resolver los nombres de sus ancestros.
          promise: fetchAllListTasks(ctx, list.id).catch(() => null),
        });
      }
    }
    const results = await Promise.all(fetches.map((f) => f.promise));

    // 3) Por list: detectar hojas y quedarse con las asignadas no conocidas.
    const out: AssignedUntrackedTask[] = [];
    let scanned = 0;
    fetches.forEach((info, i) => {
      const raw: any[] = sortByClickUpOrder([...(results[i] ?? [])]);
      scanned += raw.length;

      const byId = new Map<string, any>(raw.map((t) => [t.id, t]));
      const parentIds = new Set<string>();
      for (const t of raw) if (t.parent) parentIds.add(t.parent);

      for (const t of raw) {
        if (parentIds.has(t.id)) continue; // tiene subtareas → contenedor
        if (known.has(t.id)) continue; // ya está en Hermes
        const assignees: any[] = t.assignees ?? [];
        const mine = assignees.some(
          (a) => String(a?.id) === String(CLICKUP_USER_ID),
        );
        if (!mine) continue;

        // Cadena de ancestros dentro de la list (raíz → abajo).
        const ancestors: { id: string; name: string }[] = [];
        const seen = new Set<string>([t.id]);
        let cur = t.parent ? byId.get(t.parent) : undefined;
        while (cur && !seen.has(cur.id) && ancestors.length < 12) {
          seen.add(cur.id);
          ancestors.unshift({ id: cur.id, name: cur.name ?? "(sin nombre)" });
          cur = cur.parent ? byId.get(cur.parent) : undefined;
        }

        out.push({
          id: t.id,
          name: t.name ?? "(sin nombre)",
          status: t.status?.status ?? "to do",
          folderId: info.folderId,
          folderName: info.folderName,
          listName: info.listName,
          listId: info.listId,
          ancestors,
          parentId: t.parent ?? null,
          dueDate: t.due_date
            ? new Date(Number(t.due_date)).toISOString().slice(0, 10)
            : undefined,
        });
      }
    });

    return { tasks: out, scanned };
  },
});

/**
 * Deshace un alta hecha desde la bandeja: quita las suscripciones y borra las
 * tareas recién creadas en Hermes. No toca nada en ClickUp — la tarea sigue
 * viviendo allá, simplemente deja de estar en el tablero y vuelve a ofrecerse
 * en la bandeja.
 *
 * Pública (action) con auth.
 */
export const undoAssignedAdd = action({
  args: { sessionToken: v.string(), clickupIds: v.array(v.string()) },
  handler: async (
    ctx,
    { sessionToken, clickupIds },
  ): Promise<{ removed: number; skipped: number }> => {
    const ok = await ctx.runQuery(internal.settings._checkSession, {
      sessionToken,
    });
    if (!ok) throw new Error("No autorizado: sesión inválida o expirada");
    if (clickupIds.length === 0) return { removed: 0, skipped: 0 };

    // 1) Quitar las suscripciones (sin marcar nada como ignorado).
    await ctx.runMutation(internal.settings._setSubscriptions, {
      add: [],
      removeIds: clickupIds,
    });

    // 2) Borrar las tareas recién importadas.
    const result: { removed: number; skipped: number } = await ctx.runMutation(
      internal.clickupMutations._undoInboundAdd,
      { clickupIds },
    );
    return result;
  },
});

/**
 * Resuelve y persiste la ubicación en ClickUp (folder → list → ancestros) de
 * las tareas ya sincronizadas. Es lo que permite agrupar el tablero por
 * proyecto sin pegarle a ClickUp en cada render.
 *
 * `refreshAll = false` (por defecto) solo completa las que no la tienen o la
 * tienen a medias — es el backfill inicial y el mantenimiento habitual.
 * `refreshAll = true` la recalcula para todas: sirve cuando renombraste fases
 * o proyectos en ClickUp y las etiquetas quedaron viejas.
 *
 * Pública (action) con auth.
 */
export const backfillClickupPaths = action({
  args: { sessionToken: v.string(), refreshAll: v.optional(v.boolean()) },
  handler: async (
    ctx,
    { sessionToken, refreshAll },
  ): Promise<{ updated: number; failed: number; total: number }> => {
    const ok = await ctx.runQuery(internal.settings._checkSession, {
      sessionToken,
    });
    if (!ok) throw new Error("No autorizado: sesión inválida o expirada");

    const pending: { taskId: any; clickupId: string }[] = await ctx.runQuery(
      internal.clickupMutations._listTasksNeedingPath,
      { onlyMissing: !refreshAll },
    );

    // Caché por nodo: las tareas de un mismo proyecto comparten ancestros, así
    // que resolver 20 tareas de una fase cuesta la cadena una sola vez.
    const pathCache = new Map<string, any>();
    let updated = 0;
    let failed = 0;

    for (const { taskId, clickupId } of pending) {
      try {
        let info = pathCache.get(clickupId);
        if (!info) {
          info = await resolveTaskPathInternal(ctx, clickupId);
          pathCache.set(clickupId, info);
        }
        // El último nodo de la cadena es la tarea misma: no es un ancestro.
        const ancestors = info.path
          .slice(0, -1)
          .map((n: { name: string }) => n.name);
        await ctx.runMutation(internal.clickupMutations._setClickupPath, {
          taskId,
          clickupPath: {
            folderName: info.folderName ?? undefined,
            listName: info.listName ?? undefined,
            listId: info.listId ?? undefined,
            folderId: info.folderId ?? undefined,
            ancestors,
            resolvedAt: Date.now(),
          },
        });
        updated++;
      } catch {
        // Tarea inaccesible o borrada en ClickUp: se cuenta y se sigue. No es
        // crítico — sin ruta, la tarea cae en "Sueltas".
        failed++;
      }
    }
    return { updated, failed, total: pending.length };
  },
});

/**
 * Limpia tareas duplicadas: la misma tarea de ClickUp importada más de una
 * vez al tablero. Deja la más vieja y retira las copias (soft-delete, sin
 * tocar ClickUp).
 *
 * Existieron porque `_createInboundTask` no verificaba si el clickupId ya
 * estaba en el tablero; eso ya se corrigió, así que esto es una limpieza de
 * una sola vez para lo que quedó.
 *
 * Pública (action) con auth.
 */
export const cleanupDuplicateTasks = action({
  args: { sessionToken: v.string(), dryRun: v.optional(v.boolean()) },
  handler: async (
    ctx,
    { sessionToken, dryRun },
  ): Promise<{
    groups: number;
    removed: number;
    detail: { clickupId: string; title: string; copies: number }[];
  }> => {
    const ok = await ctx.runQuery(internal.settings._checkSession, {
      sessionToken,
    });
    if (!ok) throw new Error("No autorizado: sesión inválida o expirada");
    return await ctx.runMutation(internal.clickupMutations._dedupeClickupTasks, {
      dryRun: dryRun === true,
    });
  },
});

// ============================================================
//  ÍNDICE DE BÚSQUEDA (buscador de destino del picker)
// ============================================================

/** Una tarea del índice de búsqueda, aplanada con su ubicación. */
export interface SearchEntry {
  id: string;
  name: string;
  status: string;
  /** ClickUp id del padre directo (null = raíz de la list). */
  parent: string | null;
  listId: string;
  listName: string;
  folderId: string;
  folderName: string;
}

/**
 * Un "contenedor" buscable: un folder (proyecto) o una list. Elegir uno no
 * ancla la tarea a ningún nodo: abre la jerarquía en el picker para que el
 * usuario elija el nivel exacto a mano.
 */
export interface SearchContainer {
  kind: "folder" | "list";
  id: string;
  name: string;
  folderId: string;
  folderName: string;
  /** List donde abrir el árbol (para folder: su primera list). */
  listId: string;
  listName: string;
}

/**
 * Índice plano de TODAS las tareas del space (con subtareas) para el buscador
 * de destino: el usuario escribe, el cliente filtra este índice en memoria.
 *
 * La búsqueda server-side de ClickUp (`?query=` en team tasks) se ignora en
 * este workspace (probado: devuelve lo mismo para cualquier texto), así que
 * el índice se trae completo UNA vez y el filtrado es local e instantáneo.
 *
 * Folders en paralelo → lists con subtasks paginadas en paralelo.
 * Pública (action) con auth.
 */
export const getSearchIndex = action({
  args: { sessionToken: v.string() },
  handler: async (ctx, {
    sessionToken,
  }): Promise<{ entries: SearchEntry[]; containers: SearchContainer[] }> => {
    const ok = await ctx.runQuery(internal.settings._checkSession, {
      sessionToken,
    });
    if (!ok) throw new Error("No autorizado: sesión inválida o expirada");

    const folders: any[] = await mcpSpaceFolders(ctx);

    // Lanzar en paralelo: todas las páginas de todas las lists, cada fetch
    // con su metadata de ubicación (folder/list) pegada al costado.
    const jobs: { fetch: Promise<any>; meta: { folderId: string; folderName: string; listId: string; listName: string } }[] = [];
    const containers: SearchContainer[] = [];
    for (const folder of folders) {
      const lists = (folder.lists ?? []).filter(
        (l: any) => !l.archived,
      ) as { id: string; name: string }[];
      if (lists.length === 0) continue;
      containers.push({
        kind: "folder",
        id: folder.id,
        name: folder.name ?? "?",
        folderId: folder.id,
        folderName: folder.name ?? "?",
        listId: lists[0].id,
        listName: lists[0].name,
      });
      for (const list of lists) {
        containers.push({
          kind: "list",
          id: list.id,
          name: list.name,
          folderId: folder.id,
          folderName: folder.name ?? "?",
          listId: list.id,
          listName: list.name,
        });
      }
      for (const list of folder.lists ?? []) {
        if (list.archived) continue;
        const m = {
          folderId: folder.id,
          folderName: folder.name ?? "?",
          listId: list.id,
          listName: list.name ?? "?",
        };
        // WithParents trae TODO lo paginado interno + parent estampado.
        jobs.push({
          fetch: fetchAllListTasksWithParents(ctx, list.id).catch(() => null),
          meta: m,
        });
      }
    }
    const results = await Promise.all(jobs.map((j) => j.fetch));

    const entries: SearchEntry[] = [];
    const seen = new Set<string>();
    results.forEach((data, i) => {
      // WithParents devuelve el array plano directamente (no {tasks}).
      const tasks: any[] = Array.isArray(data) ? data : (data?.tasks ?? []);
      // Página vacía = fin de esa list (o error silencioso): nada que hacer.
      for (const t of tasks) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        const m = jobs[i].meta;
        entries.push({
          id: t.id,
          name: t.name,
          status: t.status?.status ?? "to do",
          parent: t.parent ?? null,
          listId: m.listId,
          listName: m.listName,
          folderId: m.folderId,
          folderName: m.folderName,
        });
      }
    });
    return { entries, containers };
  },
});
