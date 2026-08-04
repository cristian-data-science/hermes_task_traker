"use node";

import { internalAction, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  CLICKUP_USER_ID,
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

/** Convierte una fecha string (ej. "2026-07-29") a ms Unix. Null si inválida. */
function parseDateToMs(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  // Soporta formatos comunes: ISO, "2026-07-29", "29-jul-2026".
  const ts = Date.parse(dateStr);
  if (Number.isNaN(ts)) return null;
  return ts;
}

// ===== Construcción del body de tarea ClickUp =====

/** Arma el body para POST/PUT de una tarea ClickUp desde una tarea de Hermes. */
function buildTaskBody(task: Doc<"tasks">): Record<string, unknown> {
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

  // Fecha de entrega (ms).
  const dueMs = parseDateToMs(task.dueDate);
  if (dueMs !== null) {
    body.due_date = dueMs;
    body.due_date_time = false;
  }

  // Estimación (ms, campo nativo de ClickUp).
  const estimateMs = parseEstimateMs(task.estimate);
  if (estimateMs !== null) {
    body.time_estimate = estimateMs;
  }

  // Assignee: SIEMPRE Cristian Gutiérrez, independientemente del ejecutor en
  // Hermes. Las tareas que mandamos a ClickUp deben quedar a nombre de Cris.
  body.assignees = [Number(CLICKUP_USER_ID)];

  // Prioridad: urgente → 1 (Urgente en ClickUp).
  if (task.status === "urgente") {
    body.priority = 1;
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
    const dest = resolveOutboundDestination(config, task.clickupParentId);

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
        const body = buildTaskBody(task);
        const created = await clickupFetch(`/list/${dest.listId}/task`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        const newId: string = created.id;
        const newUrl: string = `https://app.clickup.com/t/${newId}`;

        // Anidar bajo el parent si corresponde (requiere PUT separado: el
        // `parent` en el POST de creación se ignora — pitfall de ClickUp).
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
        });
      } else {
        // ===== UPDATE (incluye status/complete) =====
        const body = buildTaskBody(task);
        await clickupFetch(`/task/${task.clickupId}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        await ctx.runMutation(internal.clickupMutations._markSynced, {
          taskId,
          clickupId: task.clickupId,
          clickupUrl:
            task.clickupUrl ??
            `https://app.clickup.com/t/${task.clickupId}`,
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
          `/list/${target.listId}/task?archived=false&subtasks=true&page=${page}`,
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
      const TEAM_ID = "8623032";
      let page = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const data = await clickupFetch(
          `/team/${TEAM_ID}/task?archived=false&assignees[]=${CLICKUP_USER_ID}&page=${page}`,
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
