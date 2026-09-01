/**
 * API de la capa agente (delegación Cris ⇄ ZCode). Ver CONTRATO_AGENTE.md.
 *
 * Actores:
 *  - La app web (sesión de Cris): asigna tareas, responde preguntas, aprueba.
 *  - El puente local `agent-bridge` (misma auth RSA que Hermes usa hoy):
 *    se suscribe a `agentQueue`, reclama tareas con `claimTask` y reporta con
 *    `agentReport`. Sin endpoints HTTP públicos: todo pasa por estas
 *    funciones autenticadas con sessionToken.
 *
 * El ciclo de vida (`agentState`) es la fuente de verdad de una tarea
 * delegada; el estado del tablero (`status`) se deriva del mapeo de
 * CONTRATO_AGENTE.md §2 y se sincroniza con ClickUp como cualquier cambio.
 */

import { query, mutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAuth } from "./authGuard";
import { logEvent, logStatusChange } from "./events";
import { internal } from "./_generated/api";

const sessionArg = { sessionToken: v.string() };

/** Estados que puede reportar el agente (el ciclo arranca en encolada). */
const reportableStateUnion = v.union(
  v.literal("trabajando"),
  v.literal("pregunta"),
  v.literal("para-revision"),
  v.literal("hecho"),
  v.literal("error"),
  v.literal("cancelada"),
);

const taskTypeUnion = v.union(
  v.literal("reporte"),
  v.literal("desarrollo"),
  v.literal("analisis"),
  v.literal("ops"),
  v.literal("otro"),
);

const areaUnion = v.union(
  v.literal("patagonia"),
  v.literal("datacef"),
  v.literal("personal"),
);

/** Mapeo agentState → estado del tablero (CONTRATO_AGENTE.md §2). */
export const AGENT_STATE_TO_STATUS: Record<string, Doc<"tasks">["status"]> = {
  encolada: "pendiente",
  despachada: "en-curso",
  trabajando: "en-curso",
  pregunta: "urgente",
  "para-revision": "standby",
  hecho: "completado",
  error: "urgente",
  cancelada: "pendiente",
};

const SUMMARY_MAX = 5000;
const QUESTION_MAX = 2000;
const FOLLOWUP_MAX = 3000;

/**
 * Catálogo de modelos de respaldo: lo muestra el picker mientras el puente
 * no ha sincronizado el catálogo real de la instalación de ZCode
 * (settings `agent.models`). Si aparece un modelo nuevo, la sync lo agrega.
 */
export const FALLBACK_MODELS = [
  { id: "builtin:zai-coding-plan/GLM-5.3", label: "GLM-5.3" },
  { id: "builtin:zai-coding-plan/GLM-5.2", label: "GLM-5.2" },
  { id: "builtin:zai-coding-plan/glm-5.1-highspeed", label: "GLM-5.1 Highspeed (rápido)" },
  { id: "builtin:zai-coding-plan/glm-4.7-flash", label: "GLM-4.7 Flash (económico)" },
];

/** Carpetas por defecto del sembrado inicial (curadas; editables en la UI). */
const DEFAULT_WORKSPACES: Array<{
  label: string;
  path: string;
  area: "patagonia" | "datacef" | "personal";
  vcs: "git" | "ninguno";
  types: Array<"reporte" | "desarrollo" | "analisis" | "ops" | "otro">;
}> = [
  // ===== Reportes Power BI (C:\mcp_servers — jamás git) =====
  ...[
    "Beneficios cruzados",
    "Compras Internas PAT",
    "Cumplimiento PPTO",
    "Cumplimiento PPTO V2",
    "Día contra día",
    "followup_snowflake",
    "Home",
    "Monitor Comunidad Pro",
    "OMS",
    "Patagonia_Pro_V3",
    "Peso&Volumen",
    "Real VS Forecast",
    "Reporte eventos",
    "Resumen Kpis comerciales",
    "revision_pagos",
    "Sales weekly USA",
    "Scorecard V1",
    "Scorecard V1 - Tiendas",
    "Scorecard V2",
    "Stock Patagonia V3",
    "Stock365-EIT-StockPlanner-VNC",
    "tareas_clickup",
    "Top 100 ganadores",
    "Venta Extranjeros",
    "Venta Extranjeros - Retail",
    "Volumen Productos",
  ].map((r) => ({
    label: r,
    path: `C:\\mcp_servers\\${r}`,
    area: "patagonia" as const,
    vcs: "ninguno" as const,
    types: ["reporte" as const, "analisis" as const, "otro" as const],
  })),
  // ===== Repos de desarrollo (git_provisorio — flujo Git) =====
  ...[
    ["hermes_task_traker", "patagonia"],
    ["patagonia_core", "patagonia"],
    ["airflow_master", "patagonia"],
    ["ley_datos", "patagonia"],
    ["migracion_auth_snow", "patagonia"],
    ["transapp", "patagonia"],
    ["gps", "patagonia"],
    ["sql", "patagonia"],
    ["vps_coolify", "datacef"],
    ["aaa_web", "datacef"],
    ["voiceflow", "datacef"],
    ["allmarket", "patagonia"],
  ].map(([repo, area]) => ({
    label: repo,
    path: `C:\\Users\\patag\\git_provisorio\\${repo}`,
    area: area as "patagonia" | "datacef",
    vcs: "git" as const,
    types: ["desarrollo" as const, "analisis" as const, "ops" as const, "otro" as const],
  })),
];

/**
 * =====================
 *  HELPERS
 * =====================
 */

/**
 * Cambia el agentState de una tarea y sincroniza TODO lo derivado:
 * estado del tablero (con reorder a top de columna), completedAt, bitácora
 * y sync ClickUp outbound si la tarea es patagonia y cambió de columna.
 */
async function applyAgentState(
  ctx: MutationCtx,
  task: Doc<"tasks">,
  newState: string,
  sessionToken = "",
  extraTask: Record<string, unknown> = {},
): Promise<void> {
  const now = Date.now();
  const newStatus = AGENT_STATE_TO_STATUS[newState] ?? task.status;
  const oldStatus = task.status;

  if (newStatus !== oldStatus) {
    // Compactar columna origen y entrar ARRIBA de la destino (patrón create).
    const sourceCol = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", oldStatus))
      .collect();
    await Promise.all(
      sourceCol
        .filter((t) => t._id !== task._id && t.deletedAt === undefined)
        .sort((a, b) => a.order - b.order)
        .map((t, i) => ctx.db.patch(t._id, { order: i, updatedAt: now })),
    );
    const destCol = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", newStatus))
      .collect();
    await Promise.all(
      destCol
        .filter((t) => t._id !== task._id && t.deletedAt === undefined)
        .sort((a, b) => a.order - b.order)
        .map((t, i) => ctx.db.patch(t._id, { order: i + 1, updatedAt: now })),
    );

    await ctx.db.patch(task._id, {
      agentState: newState as Doc<"tasks">["agentState"],
      status: newStatus,
      order: 0,
      // completedAt no se pisa si ya existe (misma regla que changeStatus).
      completedAt:
        newStatus === "completado" ? (task.completedAt ?? now) : undefined,
      ...(newStatus === "completado" ? { progress: 100 } : {}),
      updatedAt: now,
      ...extraTask,
    });

    await logStatusChange(ctx, {
      taskId: task._id,
      task,
      from: oldStatus,
      to: newStatus,
      at: now,
    });

    // Sync ClickUp outbound: el agente también mueve la tarea en ClickUp.
    if (task.area === "patagonia" && task.clickupId) {
      await ctx.scheduler.runAfter(0, internal.clickup.syncTask, {
        sessionToken,
        taskId: task._id,
        op: "status",
      });
    }
  } else {
    await ctx.db.patch(task._id, {
      agentState: newState as Doc<"tasks">["agentState"],
      updatedAt: now,
      ...extraTask,
    });
  }
}

/**
 * Validación dura de la separación Git vs archivos (CONTRATO_AGENTE.md §4):
 * `desarrollo` SOLO en carpetas vcs=git; `reporte` SOLO en vcs=ninguno.
 * La llama tasks.create/update al asignar delegación y agentReport/claimTask
 * como segunda barrera.
 */
export async function validateDelegation(
  ctx: MutationCtx,
  input: {
    taskType?: string;
    workspaceId?: Id<"agentWorkspaces">;
  },
): Promise<void> {
  if (!input.taskType || !input.workspaceId) return;
  const ws = await ctx.db.get(input.workspaceId);
  if (!ws) throw new Error("Carpeta de trabajo no encontrada en el registro");
  if (input.taskType === "desarrollo" && ws.vcs !== "git") {
    throw new Error(
      "Una tarea de desarrollo solo puede ir a un repo Git (git_provisorio)",
    );
  }
  if (input.taskType === "reporte" && ws.vcs !== "ninguno") {
    throw new Error(
      "Una tarea de reporte solo puede ir a una carpeta local de C:\\mcp_servers (sin git)",
    );
  }
}

/** Cierra la corrida abierta de una tarea (si existe) con el estado final. */
async function closeOpenRun(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  state: string,
  patch: { summary?: string; exitCode?: number; error?: string } = {},
): Promise<void> {
  const runs = await ctx.db
    .query("agentRuns")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();
  const open = runs
    .filter((r) => r.state === "despachada" || r.state === "trabajando" || r.state === "pregunta")
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  if (!open) return;
  await ctx.db.patch(open._id, {
    state: state as Doc<"agentRuns">["state"],
    endedAt: Date.now(),
    updatedAt: Date.now(),
    ...patch,
  });
}

/** Lee un valor de settings por clave (funciona en queries y mutations). */
async function getSetting(
  ctx: { db: QueryCtx["db"] },
  key: string,
): Promise<string | null> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  return row?.value ?? null;
}

async function setSetting(ctx: MutationCtx, key: string, value: string): Promise<void> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  if (row) await ctx.db.patch(row._id, { value, updatedAt: Date.now() });
  else await ctx.db.insert("settings", { key, value, updatedAt: Date.now() });
}

/**
 * =====================
 *  QUERIES (lectura)
 * =====================
 */

/** Cola de despacho: tareas encoladas para el agente (suscripción del puente). */
export const agentQueue = query({
  args: sessionArg,
  handler: async (ctx, { sessionToken }) => {
    await requireAuth(ctx, sessionToken);
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_agent_state", (q) => q.eq("agentState", "encolada"))
      .collect();
    const active = tasks.filter((t) => t.deletedAt === undefined);
    return Promise.all(
      active.map(async (task) => ({
        task,
        workspace: task.workspaceId
          ? await ctx.db.get(task.workspaceId)
          : null,
      })),
    );
  },
});

/** Panorama para la vista Agente: cola, en ejecución, requiere tu OK, hecho. */
export const agentOverview = query({
  args: { ...sessionArg, since: v.optional(v.number()) },
  handler: async (ctx, { sessionToken, since }) => {
    await requireAuth(ctx, sessionToken);
    const all = await ctx.db.query("tasks").collect();
    const delegated = all.filter(
      (t) =>
        t.deletedAt === undefined &&
        t.executor === "zcode" &&
        t.agentState !== undefined,
    );
    const cut = since ?? Date.now() - 24 * 60 * 60 * 1000;
    const pick = (states: string[]) =>
      delegated.filter((t) => states.includes(t.agentState!));
    return {
      queue: pick(["encolada"]),
      working: pick(["despachada", "trabajando"]),
      review: pick(["pregunta", "para-revision", "error"]),
      done: pick(["hecho"]).filter(
        (t) => (t.completedAt ?? t.updatedAt) >= cut,
      ),
      cancelled: pick(["cancelada"]),
    };
  },
});

/** Corridas de una tarea, más reciente primero. */
export const runsByTask = query({
  args: { ...sessionArg, taskId: v.id("tasks") },
  handler: async (ctx, { sessionToken, taskId }) => {
    await requireAuth(ctx, sessionToken);
    const runs = await ctx.db
      .query("agentRuns")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();
    return runs.sort((a, b) => b.startedAt - a.startedAt);
  },
});

/** Registro de carpetas de trabajo. */
export const listWorkspaces = query({
  args: sessionArg,
  handler: async (ctx, { sessionToken }) => {
    await requireAuth(ctx, sessionToken);
    const all = await ctx.db.query("agentWorkspaces").collect();
    return all.sort((a, b) =>
      a.area === b.area ? a.label.localeCompare(b.label) : a.area.localeCompare(b.area),
    );
  },
});

/** Catálogo de modelos (sync del puente) con fallback estático. */
export const listModels = query({
  args: sessionArg,
  handler: async (ctx, { sessionToken }) => {
    await requireAuth(ctx, sessionToken);
    const raw = await getSetting(ctx, "agent.models");
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as {
          models: Array<{ id: string; label: string }>;
          default?: string;
          syncedAt?: number;
        };
        if (Array.isArray(parsed.models) && parsed.models.length > 0) {
          return parsed;
        }
      } catch {
        // JSON viejo/corrupto: cae al fallback.
      }
    }
    return { models: FALLBACK_MODELS, default: undefined, syncedAt: undefined };
  },
});

/** Estado del puente: heartbeat reciente = activo; + qué está corriendo. */
export const bridgeStatus = query({
  args: sessionArg,
  handler: async (ctx, { sessionToken }) => {
    await requireAuth(ctx, sessionToken);
    const raw = await getSetting(ctx, "agent.bridgeHeartbeat");
    const ts = raw ? Number(raw) : undefined;
    let state: {
      activeRuns: Array<{ title: string; elapsedMin: number; model?: string }>;
      queueDepth: number;
      pid: number;
    } | undefined;
    const rawState = await getSetting(ctx, "agent.bridgeState");
    if (rawState) {
      try {
        const parsed = JSON.parse(rawState);
        if (Array.isArray(parsed.activeRuns)) state = parsed;
      } catch {
        // estado viejo/corrupto → sin detalle
      }
    }
    return {
      lastHeartbeat: ts && !Number.isNaN(ts) ? ts : undefined,
      active: !!ts && Date.now() - ts < 3 * 60 * 1000,
      activeRuns: state?.activeRuns ?? [],
      queueDepth: state?.queueDepth ?? 0,
    };
  },
});

/**
 * =====================
 *  MUTATIONS — puente (agent-bridge)
 * =====================
 */

/** Heartbeat del puente (cada 60 s) + estado vivo (qué está corriendo). */
export const bridgeHeartbeat = mutation({
  args: {
    ...sessionArg,
    /** Estado en vivo: corridas activas y profundidad de cola (JSON en settings). */
    state: v.optional(
      v.object({
        activeRuns: v.array(
          v.object({
            title: v.string(),
            elapsedMin: v.number(),
            model: v.optional(v.string()),
          }),
        ),
        queueDepth: v.number(),
        pid: v.number(),
      }),
    ),
  },
  handler: async (ctx, { sessionToken, state }) => {
    await requireAuth(ctx, sessionToken);
    await setSetting(ctx, "agent.bridgeHeartbeat", String(Date.now()));
    if (state !== undefined) {
      await setSetting(ctx, "agent.bridgeState", JSON.stringify(state));
    }
  },
});

/**
 * Actividad en vivo de una corrida: el puente la reporta leyendo el transcript
 * de la sesión (última acción del agente entre pasos explícitos --step) y
 * promueve despachada→trabajando con la primera señal de vida.
 */
export const runActivity = mutation({
  args: {
    ...sessionArg,
    taskId: v.id("tasks"),
    runId: v.id("agentRuns"),
    activity: v.string(),
    stalled: v.optional(v.boolean()),
  },
  handler: async (ctx, { sessionToken, taskId, runId, activity, stalled }) => {
    await requireAuth(ctx, sessionToken);
    const run = await ctx.db.get(runId);
    if (!run || run.taskId !== taskId) throw new Error("Corrida no encontrada");
    const now = Date.now();
    await ctx.db.patch(runId, {
      lastActivity: activity.slice(0, 200),
      lastActivityAt: now,
      activityCount: (run.activityCount ?? 0) + 1,
      ...(stalled !== undefined ? { stalled } : {}),
      updatedAt: now,
    });
    const task = await ctx.db.get(taskId);
    if (task && task.agentState === "despachada") {
      // Primera señal de vida: despachada → trabajando (mismo status Kanban).
      await ctx.db.patch(taskId, { agentState: "trabajando", updatedAt: now });
    }
    return { ok: true };
  },
});

/** Sync del catálogo de modelos de la instalación local de ZCode. */
export const syncModels = mutation({
  args: {
    ...sessionArg,
    models: v.array(v.object({ id: v.string(), label: v.string() })),
    default: v.optional(v.string()),
  },
  handler: async (ctx, { sessionToken, models, default: defaultModel }) => {
    await requireAuth(ctx, sessionToken);
    await setSetting(
      ctx,
      "agent.models",
      JSON.stringify({ models, default: defaultModel, syncedAt: Date.now() }),
    );
  },
});

/**
 * El puente reclama una tarea encolada: la marca despachada y abre la corrida.
 * Devuelve el followUp pendiente (respuesta/feedback de Cris) para que el
 * puente lo empaquete en el prompt de seguimiento, y lo limpia de la tarea.
 */
export const claimTask = mutation({
  args: {
    ...sessionArg,
    taskId: v.id("tasks"),
    promptDigest: v.optional(v.string()),
    resumed: v.optional(v.boolean()),
    workspacePath: v.optional(v.string()),
  },
  handler: async (ctx, { sessionToken, taskId, promptDigest, resumed, workspacePath }) => {
    await requireAuth(ctx, sessionToken);
    const task = await ctx.db.get(taskId);
    if (!task || task.deletedAt !== undefined)
      throw new Error("Tarea no encontrada");
    if (task.agentState !== "encolada")
      throw new Error(`La tarea no está encolada (estado: ${task.agentState})`);

    // Segunda barrera de la separación Git/archivos (§4).
    await validateDelegation(ctx, {
      taskType: task.taskType,
      workspaceId: task.workspaceId,
    });

    const now = Date.now();
    const followUp = task.agentFollowUp;
    const runId = await ctx.db.insert("agentRuns", {
      taskId,
      state: "despachada",
      resumed: resumed ?? false,
      autonomy: task.autonomy,
      workspacePath: workspacePath ?? task.workspacePath,
      model: task.model,
      promptDigest: promptDigest?.slice(0, 500),
      followUp,
      startedAt: now,
      updatedAt: now,
    });

    await applyAgentState(ctx, task, "despachada", sessionToken, {
      agentFollowUp: undefined,
      agentLastStep: undefined,
      agentLastStepAt: undefined,
      workspacePath: workspacePath ?? task.workspacePath,
    });
    await logEvent(ctx, {
      taskId,
      kind: "agent_dispatched",
      task,
      at: now,
      detail: resumed ? "seguimiento (resume de sesión)" : undefined,
    });
    return { runId, followUp };
  },
});

/**
 * Reporte del agente (CLI report.mjs o hook Stop watchdog): transición de
 * estado + resumen + pregunta/progreso. Es EL punto de entrada de resultados.
 */
export const agentReport = mutation({
  args: {
    ...sessionArg,
    taskId: v.id("tasks"),
    runId: v.optional(v.id("agentRuns")),
    state: reportableStateUnion,
    summary: v.optional(v.string()),
    /** Paso del protocolo --step: texto corto que se AGREGA al progressLog. */
    step: v.optional(v.string()),
    question: v.optional(v.string()),
    progress: v.optional(v.number()),
    sessionId: v.optional(v.string()),
    exitCode: v.optional(v.number()),
    error: v.optional(v.string()),
    watchdog: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.sessionToken);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.deletedAt !== undefined)
      throw new Error("Tarea no encontrada");
    if (task.executor !== "zcode")
      throw new Error("La tarea no está delegada al agente");
    if (args.state === "pregunta" && !args.question)
      throw new Error("Estado pregunta sin pregunta");

    const now = Date.now();
    const summary = args.summary?.slice(0, SUMMARY_MAX);
    const terminal =
      args.state === "para-revision" ||
      args.state === "hecho" ||
      args.state === "error" ||
      args.state === "cancelada";

    // Corrida: la indicada, o la abierta más reciente.
    let run: Doc<"agentRuns"> | null = null;
    if (args.runId) {
      run = (await ctx.db.get(args.runId)) ?? null;
    } else {
      const runs = await ctx.db
        .query("agentRuns")
        .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
        .collect();
      run =
        runs
          .filter(
            (r) =>
              r.state === "despachada" || r.state === "trabajando" || r.state === "pregunta",
          )
          .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
    }
    if (run) {
      // Protocolo --step: cada paso se AGREGA (tope 20) y espeja en la tarea.
      const stepText = args.step?.slice(0, 120);
      let progressLog = run.progressLog;
      if (stepText) {
        progressLog = [
          ...(progressLog ?? []),
          { at: now, text: stepText },
        ].slice(-20);
      } else if (args.state === "trabajando" && summary) {
        // Reporte intermedio sin paso explícito: su primera línea entra igual
        // a la lista, para que la evolución se vea (protocolo viejo/hibrido).
        const firstLine = summary.split("\n")[0].slice(0, 120);
        if (firstLine && progressLog?.[progressLog.length - 1]?.text !== firstLine) {
          progressLog = [...(progressLog ?? []), { at: now, text: firstLine }].slice(-20);
        }
      }
      await ctx.db.patch(run._id, {
        state: args.state as Doc<"agentRuns">["state"],
        summary,
        progressLog,
        stalled: args.state === "trabajando" ? run.stalled : undefined,
        endedAt: terminal ? now : undefined,
        exitCode: args.exitCode,
        error: args.error?.slice(0, 1000),
        updatedAt: now,
      });
    }

    // Tarea: estado + snapshot de sesión + pregunta/progreso + paso espejo.
    const stepText = args.step?.slice(0, 120);
    await applyAgentState(ctx, task, args.state, args.sessionToken, {
      agentSessionId: args.sessionId ?? task.agentSessionId,
      agentQuestion:
        args.state === "pregunta"
          ? args.question!.slice(0, QUESTION_MAX)
          : undefined,
      // El último paso se limpia al re-despachar (claimTask) y se actualiza acá.
      ...(stepText
        ? { agentLastStep: stepText, agentLastStepAt: now }
        : {}),
      ...(args.progress !== undefined
        ? { progress: Math.max(0, Math.min(100, Math.round(args.progress))) }
        : {}),
    });

    await logEvent(ctx, {
      taskId: args.taskId,
      kind: args.state === "pregunta" ? "agent_question" : "agent_update",
      task,
      at: now,
      detail: [
        args.state,
        args.state === "pregunta" ? args.question : summary?.split("\n")[0],
        args.watchdog ? "(watchdog)" : undefined,
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 300),
    });
    return { ok: true };
  },
});

/**
 * El puente vincula la sesión de ZCode a la tarea/corrida cuando el proceso
 * termina (el sessionId llega en el JSON final del CLI, no al spawn).
 */
export const bindSession = mutation({
  args: {
    ...sessionArg,
    taskId: v.id("tasks"),
    sessionId: v.string(),
    runId: v.optional(v.id("agentRuns")),
  },
  handler: async (ctx, { sessionToken, taskId, sessionId, runId }) => {
    await requireAuth(ctx, sessionToken);
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Tarea no encontrada");
    await ctx.db.patch(taskId, {
      agentSessionId: sessionId,
      updatedAt: Date.now(),
    });
    if (runId) {
      const run = await ctx.db.get(runId);
      if (run && !run.sessionId) {
        await ctx.db.patch(runId, { sessionId, updatedAt: Date.now() });
      }
    }
    return { ok: true };
  },
});

/** Info mínima de una tarea para que report.mjs decida si notifica por WhatsApp. */
export const taskForNotify = query({
  args: { ...sessionArg, taskId: v.id("tasks") },
  handler: async (ctx, { sessionToken, taskId }) => {
    await requireAuth(ctx, sessionToken);
    const task = await ctx.db.get(taskId);
    if (!task) return null;
    return {
      title: task.title,
      notifyWhatsapp: task.notifyWhatsapp ?? "off",
      agentState: task.agentState ?? null,
    };
  },
});

/**
 * =====================
 *  MUTATIONS — Cris (desde la app)
 * =====================
 */

/** Responde una pregunta del agente: re-encola con la respuesta como followUp. */
export const answerQuestion = mutation({
  args: { ...sessionArg, taskId: v.id("tasks"), answer: v.string() },
  handler: async (ctx, { sessionToken, taskId, answer }) => {
    await requireAuth(ctx, sessionToken);
    const task = await ctx.db.get(taskId);
    if (!task || task.deletedAt !== undefined)
      throw new Error("Tarea no encontrada");
    if (task.agentState !== "pregunta" && task.agentState !== "error")
      throw new Error("La tarea no está esperando tu respuesta");
    await applyAgentState(ctx, task, "encolada", sessionToken, {
      agentQuestion: undefined,
      agentFollowUp: answer.slice(0, FOLLOWUP_MAX),
    });
    await logEvent(ctx, {
      taskId,
      kind: "agent_answer",
      task,
      detail: answer.slice(0, 300),
    });
    return { ok: true };
  },
});

/** Aprueba o rechaza lo que quedó en para-revisión. */
export const reviewResult = mutation({
  args: {
    ...sessionArg,
    taskId: v.id("tasks"),
    approve: v.boolean(),
    feedback: v.optional(v.string()),
  },
  handler: async (ctx, { sessionToken, taskId, approve, feedback }) => {
    await requireAuth(ctx, sessionToken);
    const task = await ctx.db.get(taskId);
    if (!task || task.deletedAt !== undefined)
      throw new Error("Tarea no encontrada");
    if (task.agentState !== "para-revision")
      throw new Error("La tarea no está para revisión");
    if (approve) {
      await applyAgentState(ctx, task, "hecho", sessionToken);
      await closeOpenRun(ctx, taskId, "hecho");
    } else {
      if (!feedback)
        throw new Error("Para rechazar necesitas decir qué corregir");
      await applyAgentState(ctx, task, "encolada", sessionToken, {
        agentFollowUp: feedback.slice(0, FOLLOWUP_MAX),
      });
    }
    await logEvent(ctx, {
      taskId,
      kind: "agent_review",
      task,
      detail: (approve ? "aprobado" : `rechazado: ${feedback}`).slice(0, 300),
    });
    return { ok: true };
  },
});

/** Cancela la delegación (la tarea vuelve al tablero como pendiente tuya). */
export const cancelAgent = mutation({
  args: { ...sessionArg, taskId: v.id("tasks") },
  handler: async (ctx, { sessionToken, taskId }) => {
    await requireAuth(ctx, sessionToken);
    const task = await ctx.db.get(taskId);
    if (!task || task.deletedAt !== undefined)
      throw new Error("Tarea no encontrada");
    await applyAgentState(ctx, task, "cancelada", sessionToken, {
      agentQuestion: undefined,
      agentFollowUp: undefined,
    });
    await closeOpenRun(ctx, taskId, "cancelada");
    await logEvent(ctx, {
      taskId,
      kind: "agent_update",
      task,
      detail: "delegación cancelada por Cris",
    });
    return { ok: true };
  },
});

/**
 * =====================
 *  MUTATIONS — carpetas de trabajo
 * =====================
 */

/** Siembra/actualiza el registro con las carpetas curadas (upsert idempotente). */
export const seedWorkspaces = mutation({
  args: sessionArg,
  handler: async (ctx, { sessionToken }) => {
    await requireAuth(ctx, sessionToken);
    const existing = await ctx.db.query("agentWorkspaces").collect();
    const byPath = new Map(existing.map((w) => [w.path.toLowerCase(), w]));
    const now = Date.now();
    let added = 0;
    let updated = 0;
    for (const w of DEFAULT_WORKSPACES) {
      const prev = byPath.get(w.path.toLowerCase());
      if (!prev) {
        await ctx.db.insert("agentWorkspaces", {
          label: w.label,
          path: w.path,
          area: w.area,
          vcs: w.vcs,
          types: w.types,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        });
        added++;
        continue;
      }
      // Upsert suave: refresca clasificación (vcs/types) sin pisar el label
      // o el enabled que Cris haya editado a mano.
      if (prev.vcs !== w.vcs || JSON.stringify(prev.types ?? []) !== JSON.stringify(w.types)) {
        await ctx.db.patch(prev._id, {
          vcs: w.vcs,
          types: w.types,
          updatedAt: now,
        });
        updated++;
      }
    }
    return { added, updated, total: existing.length + added };
  },
});

export const addWorkspace = mutation({
  args: {
    ...sessionArg,
    label: v.string(),
    path: v.string(),
    area: areaUnion,
    vcs: v.union(v.literal("git"), v.literal("ninguno")),
    types: v.optional(v.array(taskTypeUnion)),
  },
  handler: async (ctx, { sessionToken, label, path, area, vcs, types }) => {
    await requireAuth(ctx, sessionToken);
    const existing = await ctx.db.query("agentWorkspaces").collect();
    if (existing.some((w) => w.path.toLowerCase() === path.toLowerCase()))
      throw new Error("Esa carpeta ya está registrada");
    const now = Date.now();
    return await ctx.db.insert("agentWorkspaces", {
      label: label.slice(0, 100),
      path,
      area,
      vcs,
      types: types?.length ? types : undefined,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateWorkspace = mutation({
  args: {
    ...sessionArg,
    id: v.id("agentWorkspaces"),
    label: v.optional(v.string()),
    path: v.optional(v.string()),
    area: v.optional(areaUnion),
    vcs: v.optional(v.union(v.literal("git"), v.literal("ninguno"))),
    types: v.optional(v.array(taskTypeUnion)),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, { sessionToken, id, ...patch }) => {
    await requireAuth(ctx, sessionToken);
    const ws = await ctx.db.get(id);
    if (!ws) throw new Error("Carpeta no encontrada");
    const clean: Record<string, unknown> = { updatedAt: Date.now() };
    if (patch.label !== undefined) clean.label = patch.label.slice(0, 100);
    if (patch.path !== undefined) clean.path = patch.path;
    if (patch.area !== undefined) clean.area = patch.area;
    if (patch.vcs !== undefined) clean.vcs = patch.vcs;
    if (patch.types !== undefined)
      clean.types = patch.types.length ? patch.types : undefined;
    if (patch.enabled !== undefined) clean.enabled = patch.enabled;
    await ctx.db.patch(id, clean);
    return id;
  },
});

export const removeWorkspace = mutation({
  args: { ...sessionArg, id: v.id("agentWorkspaces") },
  handler: async (ctx, { sessionToken, id }) => {
    await requireAuth(ctx, sessionToken);
    await ctx.db.delete(id);
    return id;
  },
});
