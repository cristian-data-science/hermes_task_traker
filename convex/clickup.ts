"use node";

import { internalAction, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  CLICKUP_USER_ID,
  CLICKUP_TEAM_ID,
  CLICKUP_SPACE_ID,
  SETTINGS_KEY_CONFIG,
  SETTINGS_KEY_ENABLED,
  SETTINGS_KEY_FORCE_SYNC_DEV,
  parseClickupConfig,
  resolveOutboundDestination,
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
 * Auth: token crudo en `process.env.CLICKUP_API_KEY` (secreto de Convex, sin
 * prefijo Bearer). Mismo patrón que `auth.ts`.
 *
 * Reglas:
 *  - Solo tareas con `area === "patagonia"` se sincronizan.
 *  - Si `settings.clickup.enabled === false`, no hace nada (sync en pausa).
 *  - Eliminar en Hermes = desvincular (limpiar clickupId), no borrar en ClickUp,
 *    salvo que se pida borrado explícito (op="delete").
 */

const API_BASE = "https://api.clickup.com/api/v2";

/** Lee el token de ClickUp del entorno. Lanza si no está configurado. */
function getToken(): string {
  const token = process.env.CLICKUP_API_KEY;
  if (!token) {
    throw new Error("ClickUp no configurado: falta CLICKUP_API_KEY en el servidor");
  }
  return token;
}

/**
 * fetch con reintentos y backoff exponencial ante 429 (rate limit de ClickUp:
 * 100 req/min). Lanza tras agotar los reintentos.
 */
async function clickupFetch(
  path: string,
  options: RequestInit = {},
  retries = 3,
): Promise<any> {
  const token = getToken();
  const headers: Record<string, string> = {
    Authorization: token,
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
      // 429 → esperar y reintentar con backoff exponencial.
      if (res.status === 429) {
        if (attempt === retries) {
          throw new Error("ClickUp rate limit (429): reintentos agotados");
        }
        const waitMs = 800 * Math.pow(2, attempt);
        await sleep(waitMs);
        continue;
      }
      // 5xx → reintento simple.
      if (res.status >= 500) {
        if (attempt === retries) {
          throw new Error(`ClickUp error ${res.status}`);
        }
        await sleep(500 * Math.pow(2, attempt));
        continue;
      }
      // Otros errores (4xx) → no reintentar, lanzar para que el caller decida.
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ClickUpError(res.status, text || res.statusText);
      }
      // 204 o body vacío.
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch (err) {
      // Errores de red → reintentar. ClickUpError (4xx) → no reintentar.
      if (err instanceof ClickUpError) throw err;
      lastErr = err;
      if (attempt === retries) throw err;
      await sleep(500 * Math.pow(2, attempt));
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("ClickUp: error desconocido tras reintentos");
}

class ClickUpError extends Error {
  constructor(public status: number, message: string) {
    super(`ClickUp ${status}: ${message}`);
    this.name = "ClickUpError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

/**
 * Arma el body para POST/PUT de una tarea ClickUp desde una tarea de Hermes.
 *
 * @param isCreate  Si true (POST de creación), los campos vacíos se OMITEN
 *                  (ClickUp rechaza null en algunos campos al crear). Si false
 *                  (PUT de update), los campos vacíos se mandan como null para
 *                  LIMPIARLOS en ClickUp (ej. borrar una fecha).
 */
function buildTaskBody(task: Doc<"tasks">, isCreate = false): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: task.title,
    status: mapStatusToClickUp(task.status),
  };

  // Descripción: notes + metadata estructurada al final (requestedBy, progress).
  const metaLines: string[] = [];
  if (task.notes) metaLines.push(task.notes);
  if (task.requestedBy) metaLines.push(`Solicitado por: ${task.requestedBy}`);
  if (typeof task.progress === "number") {
    metaLines.push(`Progreso: ${task.progress}%`);
  }
  body.description = metaLines.join("\n\n") || " ";

  // Fecha de entrega (ms). En update, mandar null LIMPIA la fecha en ClickUp;
  // en create, omitimos la key si no hay fecha (ClickUp la rechaza en POST).
  const dueMs = parseDateToMs(task.dueDate);
  if (dueMs !== null) {
    body.due_date = dueMs;
    body.due_date_time = false;
  } else if (!isCreate) {
    body.due_date = null;
    body.due_date_time = false;
  }

  // Estimación (ms, campo nativo de ClickUp). Misma lógica que la fecha.
  const estimateMs = parseEstimateMs(task.estimate);
  if (estimateMs !== null) {
    body.time_estimate = estimateMs;
  } else if (!isCreate) {
    body.time_estimate = null;
  }

  // Assignee: SIEMPRE Cristian Gutiérrez, independientemente del ejecutor en
  // Hermes. Las tareas que mandamos a ClickUp deben quedar a nombre de Cris.
  body.assignees = [Number(CLICKUP_USER_ID)];

  // Prioridad según el estado de Hermes:
  //   urgente   → 1 (Urgente)
  //   en-curso  → 2 (Alta)
  //   resto     → 3 (Normal) — pendiente, standby, programado, completado.
  // La prioridad se manda SIEMPRE (incluso al actualizar) para que al mover de
  // urgente/en-curso a otro estado, ClickUp la baje a Normal.
  switch (task.status) {
    case "urgente":
      body.priority = 1;
      break;
    case "en-curso":
      body.priority = 2;
      break;
    default:
      body.priority = 3;
      break;
  }

  return body;
}

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
    const deployment = process.env.CONVEX_CLOUD_DEPLOYMENT ?? "";
    if (!deployment.startsWith("prod:")) {
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
    if (task.area !== "patagonia") return;

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

    try {
      if (op === "delete") {
        // Borrado explícito: eliminar en ClickUp si estaba sincronizada.
        if (task.clickupId) {
          await clickupFetch(`/task/${task.clickupId}`, { method: "DELETE" });
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
        const body = buildTaskBody(task, true);
        const created = await clickupFetch(`/list/${dest.listId}/task`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        const newId: string = created.id;
        const newUrl: string = `https://app.clickup.com/t/${newId}`;

        // Anidar bajo el parent si corresponde (requiere PUT separado: el
        // `parent` en el POST de creación se ignora — pitfall de ClickUp).
        //
        // OJO: al anidarla, ClickUp la MUEVE a la list del parent, que puede
        // no ser `dest.listId`. Persistimos la list que devuelve la respuesta,
        // no la que pedimos: guardar la supuesta dejaba el clickupListId
        // apuntando a otra list (típicamente Mesa Técnica) y el selector
        // reabría la tarea en el proyecto equivocado.
        let finalListId = dest.listId;
        if (dest.parentId) {
          const nested = await clickupFetch(`/task/${newId}`, {
            method: "PUT",
            body: JSON.stringify({ parent: dest.parentId }),
          });
          if (nested?.list?.id) finalListId = nested.list.id;
        }

        await ctx.runMutation(internal.clickupMutations._markSynced, {
          taskId,
          clickupId: newId,
          clickupUrl: newUrl,
          clickupListId: finalListId,
        });
      } else {
        // ===== UPDATE (incluye status/complete) =====
        const body = buildTaskBody(task, false);
        try {
          await clickupFetch(`/task/${task.clickupId}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
        } catch (updateErr) {
          // Si la tarea fue borrada en ClickUp (404 / "not found"), la
          // desvinculamos y la recreamos en el destino correcto en vez de
          // dejarla con error rojo para siempre.
          const msg =
            updateErr instanceof Error ? updateErr.message : String(updateErr);
          if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
            await ctx.runMutation(internal.clickupMutations._unlinkClickUp, {
              taskId,
            });
            // Recrear en el destino correcto.
            const created = await clickupFetch(`/list/${dest.listId}/task`, {
              method: "POST",
              body: JSON.stringify(buildTaskBody(task, true)),
            });
            const newId: string = created.id;
            const newUrl: string = `https://app.clickup.com/t/${newId}`;
            if (dest.parentId) {
              await clickupFetch(`/task/${newId}`, {
                method: "PUT",
                body: JSON.stringify({ parent: dest.parentId }),
              });
            }
            await ctx.runMutation(internal.clickupMutations._markSynced, {
              taskId,
              clickupId: newId,
              clickupUrl: newUrl,
              clickupListId: dest.listId,
            });
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
      for (const dest of proj.destinations) {
        targets.push({
          listId: proj.listId,
          label: `${proj.label} · ${dest.label}`,
        });
      }
    }
    for (const target of targets) {
      let page = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const data = await clickupFetch(
          `/list/${target.listId}/task?archived=false&subtasks=true&include_closed=false&page=${page}`,
        );
        const tasks: any[] = data?.tasks ?? [];
        if (tasks.length === 0) break;
        for (const t of tasks) {
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
        if (tasks.length < 100) break; // última página
        page++;
      }
    }

    // ===== Fuente 2: TODAS las tareas asignadas a Cris en el workspace =====
    // Independientemente de la config trackeada. Si a Cris lo asignan a una
    // tarea en cualquier list/folder, debe aparecer en el modal.
    {
      let page = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const data = await clickupFetch(
          `/team/${CLICKUP_TEAM_ID}/task?archived=false&include_closed=false&assignees[]=${CLICKUP_USER_ID}&page=${page}`,
        );
        const tasks: any[] = data?.tasks ?? [];
        if (tasks.length === 0) break;
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
        if (tasks.length < 100) break; // última página
        page++;
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

    const newTasks: InboundNewTask[] = [];
    const statusChanges: InboundStatusChange[] = [];

    for (const ct of allClickupTasks.values()) {
      // ¿Está ignorada? Saltar (no reaparece como nueva).
      if (ignoredIds.has(ct.id)) continue;

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
    const fdata = await clickupFetch(
      `/space/${CLICKUP_SPACE_ID}/folder?archived=false`,
    );
    const folders: any[] = fdata?.folders ?? [];

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
    const data = await clickupFetch(`/folder/${folderId}/list?archived=false`);
    const lists: any[] = data?.lists ?? [];
    return {
      lists: lists.map((l) => ({ id: l.id, name: l.name })),
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
    const rawRoots: any[] = [];
    let page = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const data = await clickupFetch(
        `/list/${listId}/task?archived=false&subtasks=true&include_closed=false&page=${page}`,
      );
      const tasks: any[] = data?.tasks ?? [];
      if (tasks.length === 0) break;
      // Raíces = tareas sin parent.
      for (const t of tasks) if (!t.parent) rawRoots.push(t);
      if (tasks.length < 100) break;
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
    const rawChildren: any[] = [];
    let page = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const data = await clickupFetch(
        `/list/${listId}/task?archived=false&subtasks=true&include_closed=false&parent=${parentId}&page=${page}`,
      );
      const tasks: any[] = data?.tasks ?? [];
      if (tasks.length === 0) break;
      // Filtrar client-side: solo hijas directas reales de parentId.
      for (const t of tasks) if (t.parent === parentId) rawChildren.push(t);
      if (tasks.length < 100) break;
      page++;
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
    const deployment = process.env.CONVEX_CLOUD_DEPLOYMENT ?? "";
    if (!deployment.startsWith("prod:")) {
      const forceRow = await ctx.runQuery(internal.settings._getRaw, {
        key: SETTINGS_KEY_FORCE_SYNC_DEV,
      });
      if (forceRow?.value !== "true") {
        throw new Error(
          "Creación desactivada en dev. Activá 'Forzar sync en dev' en el panel ⚙️.",
        );
      }
    }

    const body: Record<string, unknown> = {
      name,
      status: status ?? "to do",
      assignees: [Number(CLICKUP_USER_ID)],
    };
    const created = await clickupFetch(`/list/${listId}/task`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const id: string = created.id;
    return { id, name: created.name, url: `https://app.clickup.com/t/${id}` };
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
/** Máximo de páginas por list (100 tareas c/u). Tope defensivo. */
const MAX_LIST_PAGES = 20;

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
async function fetchAllListTasks(listId: string): Promise<any[]> {
  const all: any[] = [];
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const data = await clickupFetch(
      `/list/${listId}/task?archived=false&subtasks=true&include_closed=false&page=${page}`,
    );
    const tasks: any[] = data?.tasks ?? [];
    all.push(...tasks);
    if (tasks.length < 100) break;
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
    const fdata = await clickupFetch(
      `/space/${CLICKUP_SPACE_ID}/folder?archived=false`,
    );
    const foldersRaw: any[] = fdata?.folders ?? [];

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
          promise: fetchAllListTasks(list.id).catch(() => null),
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
    }[] = [];
    /** Nodos que se suscribieron pero cuyo detalle no se pudo traer. */
    const failed: { id: string; label: string; error: string }[] = [];

    for (const node of add) {
      if (node.nodeType === "task") {
        // Tarea individual: traer su detalle.
        try {
          const t = await clickupFetch(`/task/${node.id}`);
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
        const listIds: string[] = [];
        if (node.nodeType === "folder") {
          const fdata = await clickupFetch(
            `/folder/${node.id}/list?archived=false`,
          );
          for (const l of fdata?.lists ?? []) listIds.push(l.id);
        } else {
          listIds.push(node.id);
        }
        for (const listId of listIds) {
          let page = 0;
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const tdata = await clickupFetch(
              `/list/${listId}/task?archived=false&subtasks=true&include_closed=false&page=${page}`,
            );
            const tasks: any[] = tdata?.tasks ?? [];
            if (tasks.length === 0) break;
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
              });
            }
            if (tasks.length < 100) break;
            page++;
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
    for (const entry of existing.allEntries) {
      if (entry.deleted) continue;
      try {
        const t = await clickupFetch(`/task/${entry.clickupId}`);
        const assigneeName = t.assignees?.[0]?.username
          ? String(t.assignees[0].username).split(" ")[0]
          : undefined;
        const isAssignedToCris = (t.assignees ?? []).some(
          (a: any) => Number(a.id) === Number(CLICKUP_USER_ID),
        );
        await ctx.runMutation(internal.clickupMutations._updateAssignee, {
          taskId: entry.taskId,
          executor: isAssignedToCris ? "cris" : undefined,
          clickupAssignee: assigneeName,
        });
        fixed++;
      } catch {
        // tarea inaccesible → saltar
      }
    }
    return { fixed };
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
      const t = await clickupFetch(`/task/${clickupId}`);
      return {
        listId: t.list?.id ?? null,
        folderId: t.folder?.id ?? null,
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

    const path: ClickupPathNode[] = [];
    let listId: string | null = null;
    let listName: string | null = null;
    let folderId: string | null = null;
    let folderName: string | null = null;

    let currentId: string | null = clickupId;
    const seen = new Set<string>();
    for (let hop = 0; currentId && hop < 12; hop++) {
      if (seen.has(currentId)) break; // ciclo defensivo
      seen.add(currentId);
      let t: any;
      try {
        t = await clickupFetch(`/task/${currentId}`);
      } catch {
        break; // el nodo ya no existe en ClickUp: devolvemos lo resuelto
      }
      if (!t?.id) break;
      if (hop === 0) {
        listId = t.list?.id ?? null;
        listName = t.list?.name ?? null;
        // ClickUp marca folder.hidden = true cuando la list cuelga directo del
        // space (sin folder real). En ese caso no hay folder que mostrar.
        folderId = t.folder?.hidden ? null : (t.folder?.id ?? null);
        folderName = t.folder?.hidden ? null : (t.folder?.name ?? null);
      }
      path.unshift({ id: t.id, name: t.name ?? "(sin nombre)" });
      currentId = t.parent ?? null;
    }

    return { listId, listName, folderId, folderName, path };
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

    // 1) Qué hay ya en Hermes (incluye borradas/ignoradas: no reofrecerlas).
    const existing = await ctx.runQuery(
      internal.clickupMutations._listMappedForInbound,
      {},
    );
    const known = new Set(existing.allEntries.map((e) => e.clickupId));

    // 2) Estructura del space (mismo camino que getWorkspaceTree).
    const fdata = await clickupFetch(
      `/space/${CLICKUP_SPACE_ID}/folder?archived=false`,
    );
    const folderData = sortByClickUpOrder([...(fdata?.folders ?? [])])
      .map((folder: any) => ({
        id: folder.id,
        name: folder.name ?? "Sin nombre",
        lists: sortByClickUpOrder(
          (folder.lists ?? []).filter((l: any) => !l.archived),
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
          promise: fetchAllListTasks(list.id).catch(() => null),
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
