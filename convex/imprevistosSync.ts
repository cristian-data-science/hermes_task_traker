"use node";

/**
 * Sync ClickUp de los imprevistos del panel Hoy.
 *
 * Cada imprevisto se refleja como SUBTAREA de la tarea "Imprevistos Cris"
 * (raíz de la List Mesa Técnica del workspace Patagonia):
 *
 *   crear imprevisto   → clickup_create_task con parent (el MCP anida en el
 *                         mismo call; ver nota en clickup.ts syncTask CREATE)
 *   resolver/reabrir   → clickup_update_task status complete/to do
 *   borrar imprevisto  → clickup_delete_task de la subtask (sin dejar basura)
 *   promover           → quitar el parent a la MISMA subtask; si el MCP no
 *                         lo soporta, fallback: borrar subtask + crear la
 *                         tarea de primer nivel en Mesa Técnica
 *
 * Espeja las reglas de syncTask: guards de entorno (producción o
 * forceSyncDev) y de `clickup.enabled`; best-effort sin re-lanzar (el error
 * queda en la fila y el sweep lo reintenta); runtime Node para fetch, con
 * la persistencia en imprevistos.ts (V8) vía internal functions.
 */

import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  CLICKUP_USER_ID,
  SETTINGS_KEY_CONFIG,
  SETTINGS_KEY_ENABLED,
  SETTINGS_KEY_FORCE_SYNC_DEV,
  SETTINGS_KEY_IMPREVISTOS_PARENT,
  parseClickupConfig,
  isProductionDeployment,
} from "./clickupConfig";
import {
  mcpCall,
  requireMcpToken,
  mcpStructured,
} from "./clickup";

/** Nombre exacto de la tarea padre en Mesa Técnica. */
const IMPREVISTOS_PARENT_NAME = "Imprevistos Cris";

/** Normaliza nombres para comparar (el find del padre no distingue mayúsculas). */
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

// ============================================================
//  Guards y helpers compartidos
// ============================================================

/**
 * Guards de entorno, idénticos a syncTask: en dev no se escribe NADA en el
 * ClickUp compartido salvo override explícito (forceSyncDev), y si el sync
 * está pausado (enabled=false) los imprevistos quedan 100% locales.
 */
async function guardsPass(ctx: ActionCtx): Promise<boolean> {
  if (!isProductionDeployment()) {
    const forceRow = await ctx.runQuery(internal.settings._getRaw, {
      key: SETTINGS_KEY_FORCE_SYNC_DEV,
    });
    if (forceRow?.value !== "true") return false;
  }
  const enabledRow = await ctx.runQuery(internal.settings._getRaw, {
    key: SETTINGS_KEY_ENABLED,
  });
  if (enabledRow?.value === "false") return false;
  return true;
}

/** List de Mesa Técnica desde la config (default si no hay config guardada). */
async function mesaTecnicaListId(ctx: ActionCtx): Promise<string> {
  const configRow = await ctx.runQuery(internal.settings._getRaw, {
    key: SETTINGS_KEY_CONFIG,
  });
  return parseClickupConfig(configRow?.value).mesaTecnica.listId;
}

/**
 * Find-or-create del padre "Imprevistos Cris" (raíz de Mesa Técnica), con el
 * id cacheado en settings para no paginar ClickUp en cada alta. Si alguien
 * borra el padre en ClickUp, el create falla, se invalida el cache y el
 * próximo intento lo recrea (ver el retry en syncRow).
 */
async function ensureParent(ctx: ActionCtx): Promise<string> {
  const cached = await ctx.runQuery(internal.settings._getRaw, {
    key: SETTINGS_KEY_IMPREVISTOS_PARENT,
  });
  if (cached?.value) return cached.value;

  const token = await requireMcpToken(ctx);
  const listId = await mesaTecnicaListId(ctx);

  // Buscar entre las RAÍCES de Mesa Técnica (subtasks:false excluye a todas
  // las descendientes — mismo truco que listProjectRoots).
  let page = 0;
  while (true) {
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
    const hit = tasks.find((t: any) => norm(t.name) === norm(IMPREVISTOS_PARENT_NAME));
    if (hit) {
      const id = String(hit.id);
      await ctx.runMutation(internal.settings._upsertRaw, {
        key: SETTINGS_KEY_IMPREVISTOS_PARENT,
        value: id,
      });
      return id;
    }
    const next = sc.next_page;
    if (!sc.has_more || typeof next !== "number" || next <= page) break;
    page++;
  }

  // No existe: crearla como raíz de Mesa Técnica.
  const created = await mcpCall(
    "clickup_create_task",
    { name: IMPREVISTOS_PARENT_NAME, list_id: listId },
    token,
  );
  const csc = mcpStructured(created) ?? {};
  const id = String(csc.task_id ?? "");
  if (!id) throw new Error("create_task no devolvió task_id (padre imprevistos)");
  await ctx.runMutation(internal.settings._upsertRaw, {
    key: SETTINGS_KEY_IMPREVISTOS_PARENT,
    value: id,
  });
  return id;
}

/** Invalida el cache del padre (parent borrado en ClickUp → recrear). */
async function invalidateParentCache(ctx: ActionCtx): Promise<void> {
  await ctx.runMutation(internal.settings._upsertRaw, {
    key: SETTINGS_KEY_IMPREVISTOS_PARENT,
    value: "",
  });
}

/** ¿El error parece "el parent cacheado ya no existe"? */
function errorLooksLikeBadParent(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("parent") &&
    (m.includes("not found") || m.includes("invalid") || m.includes("404"))
  );
}

// ============================================================
//  Sync state-based de UNA fila
// ============================================================

/**
 * Sincroniza el estado ACTUAL del imprevisto hacia su subtask (state-based,
 * no op-based: siempre converge sin importar cuántas cosas pasaron mientras
 * ClickUp estuvo caído). Requiere claim previo para el create.
 */
async function syncRow(
  ctx: ActionCtx,
  row: Doc<"imprevistos">,
): Promise<"done" | "skip"> {
  // Borrado: eliminar la subtask si existía y soltar la vinculación.
  if (row.deletedAt !== undefined) {
    if (row.clickupSubtaskId) {
      const token = await requireMcpToken(ctx);
      try {
        await mcpCall(
          "clickup_delete_task",
          { task_id: row.clickupSubtaskId },
          token,
        );
      } catch {
        // Ya no existía allá (borrada a mano): desvincular igual.
      }
      await ctx.runMutation(internal.imprevistos._clearSync, {
        imprevistoId: row._id,
      });
    }
    return "done";
  }

  // Promovidos: los maneja promoteImprevisto, no acá.
  if (row.promotedAt !== undefined) return "skip";

  const token = await requireMcpToken(ctx);
  const listId = await mesaTecnicaListId(ctx);
  const status = row.resolvedAt !== undefined ? "complete" : "to do";

  if (!row.clickupSubtaskId) {
    // ===== CREATE (bajo el padre, con claim anti-doble-create) =====
    const claimed = await ctx.runMutation(internal.imprevistos._claimForSync, {
      imprevistoId: row._id,
    });
    if (!claimed) return "skip";

    try {
      const parentId = await ensureParent(ctx);
      const created = await mcpCall(
        "clickup_create_task",
        {
          name: row.title,
          markdown_description: "Imprevisto registrado desde Hermes (panel Hoy).",
          list_id: listId,
          parent: parentId,
          status,
          assignees: [CLICKUP_USER_ID],
        },
        token,
      );
      const sc = mcpStructured(created) ?? {};
      const id = String(sc.task_id ?? "");
      if (!id) throw new Error("create_task no devolvió task_id");
      await ctx.runMutation(internal.imprevistos._markSynced, {
        imprevistoId: row._id,
        clickupSubtaskId: id,
        clickupUrl: sc.task_url ? String(sc.task_url) : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Padre cacheado inválido (lo borraron en ClickUp): invalidar y
      // reintentar UNA vez — el próximo ensureParent lo recrea.
      if (errorLooksLikeBadParent(msg)) {
        await invalidateParentCache(ctx);
        try {
          const parentId = await ensureParent(ctx);
          const created = await mcpCall(
            "clickup_create_task",
            {
              name: row.title,
              markdown_description:
                "Imprevisto registrado desde Hermes (panel Hoy).",
              list_id: listId,
              parent: parentId,
              status,
              assignees: [CLICKUP_USER_ID],
            },
            token,
          );
          const sc2 = mcpStructured(created) ?? {};
          const id2 = String(sc2.task_id ?? "");
          if (!id2) throw new Error("create_task no devolvió task_id");
          await ctx.runMutation(internal.imprevistos._markSynced, {
            imprevistoId: row._id,
            clickupSubtaskId: id2,
            clickupUrl: sc2.task_url ? String(sc2.task_url) : undefined,
          });
          return "done";
        } catch (err2) {
          await ctx.runMutation(internal.imprevistos._markSyncError, {
            imprevistoId: row._id,
            error: err2 instanceof Error ? err2.message : String(err2),
          });
          return "done";
        }
      }
      await ctx.runMutation(internal.imprevistos._markSyncError, {
        imprevistoId: row._id,
        error: msg,
      });
    }
    return "done";
  }

  // ===== UPDATE (status/título de la subtask) =====
  await mcpCall(
    "clickup_update_task",
    { task_id: row.clickupSubtaskId, name: row.title, status },
    token,
  );
  await ctx.runMutation(internal.imprevistos._markSynced, {
    imprevistoId: row._id,
    clickupSubtaskId: row.clickupSubtaskId,
  });
  return "done";
}

// ============================================================
//  Promoción (subtask → tarea de primer nivel + task Hermes)
// ============================================================

/**
 * Ejecuta la parte ClickUp de la promoción y finaliza creando la tarea
 * Hermes enlazada (_finishPromotion). Estrategia: mover la MISMA subtask
 * quitándole el parent; si el MCP no lo soporta (rechaza parent null o lo
 * ignora), fallback determinista: borrar subtask + crear top-level.
 */
async function promoteRow(ctx: ActionCtx, row: Doc<"imprevistos">) {
  let current = row;

  // Asegurar que la subtask exista (promover algo nunca sincronizado).
  // syncRow hace su propio claim del create: si otra corrida lo tiene,
  // salimos y el sweep reintenta la promoción más tarde.
  if (!current.clickupSubtaskId) {
    const r = await syncRow(ctx, current);
    if (r === "skip") return;
    const fresh = await ctx.runQuery(internal.imprevistos._getInternal, {
      imprevistoId: row._id,
    });
    if (!fresh?.clickupSubtaskId) return;
    current = fresh;
  }

  // Claim para la parte de ClickUp (anti doble-promoción por sweep + retry).
  const claimed = await ctx.runMutation(internal.imprevistos._claimForSync, {
    imprevistoId: row._id,
  });
  if (!claimed) return;

  // Releer DESPUÉS del claim: otro proceso pudo completarla mientras tanto.
  const after = await ctx.runQuery(internal.imprevistos._getInternal, {
    imprevistoId: row._id,
  });
  if (!after || after.promotedTaskId !== undefined || after.deletedAt !== undefined) {
    return;
  }
  const subtaskId = after.clickupSubtaskId!;

  const token = await requireMcpToken(ctx);
  const listId = await mesaTecnicaListId(ctx);
  const wasResolved = after.resolvedAt !== undefined;
  const status = wasResolved ? "complete" : "to do";

  // 1) Intento preferido: mover la MISMA subtask (conserva id/historial).
  let finalId = subtaskId;
  let finalUrl = after.clickupUrl ?? undefined;
  let moved = false;
  try {
    await mcpCall(
      "clickup_update_task",
      { task_id: subtaskId, parent: null, list_id: listId },
      token,
    );
    // Verificar que el parent REALLY quedó fuera: si la tool ignoró el
    // argumento, la tarea sigue siendo subtask y el link quedaría mentiroso.
    const detail: any =
      mcpStructured(
        await mcpCall("clickup_get_task", { task_id: subtaskId }, token),
      ) ?? {};
    const parentAfter = detail.parent ?? detail.task?.parent ?? null;
    moved = !parentAfter;
  } catch {
    moved = false;
  }

  // 2) Fallback: borrar la subtask y crear la tarea de primer nivel.
  if (!moved) {
    try {
      await mcpCall("clickup_delete_task", { task_id: subtaskId }, token);
    } catch {
      // Ya no existía: igual se crea la top-level.
    }
    const created = await mcpCall(
      "clickup_create_task",
      {
        name: after.title,
        markdown_description: "Promovido desde imprevisto (panel Hoy de Hermes).",
        list_id: listId,
        status,
        assignees: [CLICKUP_USER_ID],
      },
      token,
    );
    const sc = mcpStructured(created) ?? {};
    finalId = String(sc.task_id ?? "");
    if (!finalId) throw new Error("create_task no devolvió task_id al promover");
    finalUrl = sc.task_url ? String(sc.task_url) : undefined;
  }

  await ctx.runMutation(internal.imprevistos._finishPromotion, {
    imprevistoId: row._id,
    clickupTaskId: finalId,
    clickupUrl: finalUrl,
    status: wasResolved ? "completado" : "pendiente",
  });
}

// ============================================================
//  Actions (scheduler)
// ============================================================

/**
 * Sincroniza un imprevisto puntual (agendada por resolve/reopen/remove).
 * Si otra corrida tiene el claim (create en curso), syncRow devuelve "skip"
 * y esta action se re-agenda con backoff corto para llegar después y aplicar
 * el estado final (p.ej. el complete que llegó mientras se creaba).
 */
export const syncImprevisto = internalAction({
  args: { imprevistoId: v.id("imprevistos"), attempt: v.optional(v.number()) },
  handler: async (ctx, { imprevistoId, attempt }) => {
    if (!(await guardsPass(ctx))) return;
    const row = await ctx.runQuery(internal.imprevistos._getInternal, {
      imprevistoId,
    });
    if (!row) return;

    try {
      const r = await syncRow(ctx, row);
      if (r === "skip") {
        const n = attempt ?? 0;
        if (n < 6) {
          await ctx.scheduler.runAfter(
            5_000,
            internal.imprevistosSync.syncImprevisto,
            { imprevistoId, attempt: n + 1 },
          );
        }
      }
    } catch (err) {
      // Igual que syncTask: registrar y NO relanzar (reintenta el sweep).
      await ctx.runMutation(internal.imprevistos._markSyncError, {
        imprevistoId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});

/**
 * Sweep: procesa imprevistos pendientes (sin subtask, o promociones a
 * medias). Agendado en cada alta — es el reintento implícito de todo lo que
 * falló mientras ClickUp estuvo caído. Cada fila se procesa con try/catch
 * propio: un error no frena al resto.
 */
export const sweepPending = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!(await guardsPass(ctx))) return;
    const rows = await ctx.runQuery(internal.imprevistos._pendingSync, {});
    for (const row of rows) {
      try {
        if (row.promotedAt !== undefined && row.promotedTaskId === undefined) {
          await promoteRow(ctx, row);
        } else {
          await syncRow(ctx, row);
        }
      } catch (err) {
        await ctx.runMutation(internal.imprevistos._markSyncError, {
          imprevistoId: row._id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },
});

/** Ejecuta la promoción de un imprevisto (agendada por la mutation promote). */
export const promoteImprevisto = internalAction({
  args: { imprevistoId: v.id("imprevistos") },
  handler: async (ctx, { imprevistoId }) => {
    if (!(await guardsPass(ctx))) return;
    const row = await ctx.runQuery(internal.imprevistos._getInternal, {
      imprevistoId,
    });
    if (!row || row.promotedAt === undefined || row.promotedTaskId !== undefined)
      return;
    try {
      await promoteRow(ctx, row);
    } catch (err) {
      await ctx.runMutation(internal.imprevistos._markSyncError, {
        imprevistoId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});
