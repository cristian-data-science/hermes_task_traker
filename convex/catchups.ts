/**
 * Catch-up semanal: el resumen de la semana y el ciclo que la une con la
 * siguiente.
 *
 * ===== LA IDEA =====
 * Un catch-up no es un reporte suelto: es un eslabón. Lo que presentás este
 * martes tiene que servirte el martes que viene. Por eso hay dos mitades:
 *
 *  1. **El resumen de la semana** (`getWeek`), que se arma solo con tu uso
 *     normal del tablero. No hay nada que llenar a mano.
 *  2. **El cierre** (`close`), que congela ese resumen y guarda los
 *     compromisos para la semana siguiente. La semana siguiente esos
 *     compromisos vuelven arriba, ya resueltos contra el tablero real.
 *
 * ===== DE DÓNDE SALEN LOS DATOS (modelo híbrido) =====
 * Hay dos fuentes y cada una cubre el agujero de la otra:
 *
 *  - **Timestamps de `tasks`/`subtasks`** (`createdAt`, `completedAt`): existen
 *    desde siempre, así que la vista funciona con tu historial completo desde
 *    el primer día. Pero solo saben el estado FINAL de las cosas.
 *  - **Tabla `events`**: registra el camino (movimientos entre estados,
 *    reaperturas, progreso) y sobrevive al borrado de la tarea. Empieza a
 *    llenarse desde que se instala esta rama.
 *
 * Se cruzan y se deduplican. Por eso las semanas viejas se ven bien pero un
 * poco más pobres que las nuevas: no es un bug, es que antes nadie tomaba nota.
 *
 * ===== ZONAS HORARIAS =====
 * El backend NO decide qué día es. Recibe `from`/`to` en milisegundos, ya
 * calculados por el cliente en hora local, y solo compara números. El porqué
 * está explicado en `catchupConfig.ts`.
 */

import { query, mutation, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAuth } from "./authGuard";
import {
  CATCHUP_AREAS,
  SETTINGS_KEY_CATCHUP_DAY,
  parseAnchorDay,
  ACTIVE_STATUSES,
  QUEUED_STATUSES,
  PENDING_STATUSES,
  BLOCKED_STATUSES,
} from "./catchupConfig";
import { rootIdOf, classifyChain, countFulfilled } from "./catchupLogic";

const sessionArg = { sessionToken: v.string() };

/** Largo máximo de las notas libres del catch-up. */
const NOTES_MAX = 10000;
/** Largo máximo del texto de un compromiso. */
const COMMITMENT_MAX = 300;
/** Tope de compromisos por semana: si son más de 8, no son compromisos. */
const COMMITMENTS_MAX = 8;

// ============================================================
//  TIPOS DE SALIDA
// ============================================================

/** Ubicación de una tarea en ClickUp, aplanada para la UI. */
interface Placement {
  project: string | null;
  ancestors: string[];
  clickupUrl: string | null;
}

/** Una cosa terminada durante la semana. */
export interface DoneItem extends Placement {
  taskId: string;
  title: string;
  at: number;
  status: string;
  /** Sub-tareas cerradas dentro de la ventana, para el detalle fino. */
  subtasks: { title: string; at: number }[];
  notes: string | null;
  requestedBy: string | null;
  /** false si la tarea se borró después: el trabajo igual se hizo. */
  stillExists: boolean;
}

/** Trabajo abierto en este momento. */
export interface OpenItem extends Placement {
  taskId: string;
  title: string;
  status: string;
  progress: number | null;
  /** Desde cuándo se cuenta la antigüedad (ms). */
  since: number | null;
  /**
   * Qué mide realmente `since`, para que la UI no mienta:
   *  - "status": hay un evento real de entrada al estado actual. Dato exacto.
   *  - "created": no hay bitácora (tarea anterior a esta funcionalidad); se
   *    usa la fecha de creación y la UI lo etiqueta distinto.
   *
   * Deliberadamente NO se cae a `updatedAt`: reordenar una columna reescribe
   * el `updatedAt` de todas sus tarjetas, así que una tarea parada hace un mes
   * diría "hoy" solo porque arrastraste otra tarjeta al lado. Justo el número
   * que menos se puede permitir estar mal.
   */
  sinceKind: "status" | "created";
  dueDate: string | null;
  /** Sub-tareas cerradas esta semana en una tarea que sigue abierta. */
  advancedSubtasks: { title: string; at: number }[];
}

/** Un compromiso de la semana anterior, ya resuelto contra el tablero. */
export interface ResolvedCommitment {
  id: string;
  rootId: string;
  text: string;
  taskId: string | null;
  carryCount: number;
  /** done = cumplido · progress = se movió · stalled = sin movimiento */
  outcome: "done" | "progress" | "stalled" | "gone";
  /** Explicación corta y honesta del outcome, para mostrar en la UI. */
  reason: string;
}

// `rootIdOf`, `classifyChain` y `countFulfilled` viven en `catchupLogic.ts`:
// son las reglas que producen los números que presentás, y ahí se pueden
// probar sin base de datos.

// ============================================================
//  HELPERS
// ============================================================

/** Aplana la ubicación ClickUp de una tarea. */
function placementOf(task: Doc<"tasks">): Placement {
  return {
    project: task.clickupPath?.listName?.trim() || null,
    ancestors: (task.clickupPath?.ancestors ?? []).filter(Boolean),
    clickupUrl: task.clickupUrl ?? null,
  };
}

/** ¿Esta tarea entra al catch-up? */
function inScope(task: Doc<"tasks">): boolean {
  return CATCHUP_AREAS.includes(task.area);
}

/** Lee las tareas excluidas de una semana (la X de la vista), como Set<string>. */
async function readExclusions(ctx: QueryCtx, weekStart: number): Promise<Set<string>> {
  const rows = await ctx.db
    .query("catchupExclusions")
    .withIndex("by_weekStart", (q) => q.eq("weekStart", weekStart))
    .collect();
  return new Set(rows.map((r) => String(r.taskId)));
}

/** Lee el día ancla configurado (martes por defecto). */
async function readAnchorDay(ctx: QueryCtx): Promise<number> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_CATCHUP_DAY))
    .first();
  return parseAnchorDay(row?.value);
}

/**
 * Arma el resumen completo de una ventana [from, to).
 *
 * Se extrae como función y no como query para poder reutilizarla en el cierre:
 * el snapshot que se congela tiene que ser EXACTAMENTE lo que estabas viendo
 * en pantalla cuando apretaste "Cerrar", no una segunda versión calculada con
 * otro criterio.
 */
async function buildSummary(ctx: QueryCtx, from: number, to: number) {
  // --- Carga base ---------------------------------------------------------
  const allTasks = await ctx.db.query("tasks").collect();
  const tasksById = new Map<string, Doc<"tasks">>(
    allTasks.map((t) => [t._id, t]),
  );
  const scoped = allTasks.filter(inScope);
  const live = scoped.filter((t) => t.deletedAt === undefined);

  const events = await ctx.db
    .query("events")
    .withIndex("by_at", (q) => q.gte("at", from).lt("at", to))
    .collect();
  const scopedEvents = events.filter((e) => CATCHUP_AREAS.includes(e.area));

  // --- Sub-tareas cerradas en la ventana ----------------------------------
  // Se leen de la tabla directa (no de events) para que las semanas
  // anteriores a esta funcionalidad también muestren detalle.
  const allSubtasks = await ctx.db.query("subtasks").collect();
  const subtasksClosedByTask = new Map<string, { title: string; at: number }[]>();
  for (const s of allSubtasks) {
    if (s.deletedAt !== undefined) continue;
    if (!s.done || s.completedAt === undefined) continue;
    if (s.completedAt < from || s.completedAt >= to) continue;
    const parent = tasksById.get(s.taskId);
    if (!parent || !inScope(parent)) continue;
    const list = subtasksClosedByTask.get(s.taskId) ?? [];
    list.push({ title: s.title, at: s.completedAt });
    subtasksClosedByTask.set(s.taskId, list);
  }
  for (const list of subtasksClosedByTask.values()) {
    list.sort((a, b) => a.at - b.at);
  }

  // --- HECHO: completadas en la ventana -----------------------------------
  // Fuente 1: `completedAt` de la tarea (funciona con el historial viejo).
  // Fuente 2: eventos `completed` (captura lo que después se reabrió o borró,
  //           que igual se hizo esa semana y merece contarse).
  const doneAt = new Map<string, number>();
  for (const t of scoped) {
    if (t.completedAt !== undefined && t.completedAt >= from && t.completedAt < to) {
      doneAt.set(t._id, t.completedAt);
    }
  }
  for (const e of scopedEvents) {
    if (e.kind !== "completed") continue;
    // Si ya está por `completedAt`, se queda la fecha más temprana: la primera
    // vez que se terminó es la que cuenta como el logro de la semana.
    const prev = doneAt.get(e.taskId);
    doneAt.set(e.taskId, prev === undefined ? e.at : Math.min(prev, e.at));
  }

  let done: DoneItem[] = [];
  for (const [taskId, at] of doneAt) {
    const t = tasksById.get(taskId);
    if (!t) continue;
    done.push({
      taskId,
      title: t.title,
      at,
      status: t.status,
      ...placementOf(t),
      subtasks: subtasksClosedByTask.get(taskId) ?? [],
      notes: t.notes ?? null,
      requestedBy: t.requestedBy ?? null,
      stillExists: t.deletedAt === undefined,
    });
  }
  done.sort((a, b) => a.at - b.at);
  const doneIds = new Set(done.map((d) => d.taskId));

  // --- EN CURSO y BLOQUEADO ----------------------------------------------
  const openTasks = live.filter(
    (t) =>
      (ACTIVE_STATUSES as readonly string[]).includes(t.status) ||
      (QUEUED_STATUSES as readonly string[]).includes(t.status) ||
      (PENDING_STATUSES as readonly string[]).includes(t.status) ||
      (BLOCKED_STATUSES as readonly string[]).includes(t.status),
  );

  // Última entrada al estado ACTUAL de cada tarea abierta.
  //
  // Se consulta por tarea y no escaneando la tabla entera porque `events`
  // crece sin techo con el tiempo, mientras que el índice `by_task` acota la
  // lectura a la historia de esa tarea. Y solo se hace para las tareas
  // ABIERTAS: de las completadas no interesa la antigüedad.
  //
  // Sin filtro de ventana a propósito: una tarea puede llevar tres semanas en
  // standby, y ese es exactamente el dato que se conversa en el catch-up.
  const lastStatusChange = new Map<string, number>();
  for (const t of openTasks) {
    const evs = await ctx.db
      .query("events")
      .withIndex("by_task", (q) => q.eq("taskId", t._id))
      .collect();
    let best: number | undefined;
    for (const e of evs) {
      if (e.toStatus !== t.status) continue;
      if (best === undefined || e.at > best) best = e.at;
    }
    if (best !== undefined) lastStatusChange.set(t._id, best);
  }

  const toOpenItem = (t: Doc<"tasks">): OpenItem => {
    const fromEvent = lastStatusChange.get(t._id);
    return {
      taskId: t._id,
      title: t.title,
      status: t.status,
      progress: t.progress ?? null,
      since: fromEvent ?? t.createdAt ?? null,
      sinceKind: fromEvent !== undefined ? "status" : "created",
      dueDate: t.dueDate ?? null,
      ...placementOf(t),
      advancedSubtasks: subtasksClosedByTask.get(t._id) ?? [],
    };
  };

  // Lo más viejo primero: lo que lleva más tiempo parado es lo que hay que
  // explicar, y debe estar arriba, no enterrado al final de la lista.
  const byAge = (a: OpenItem, b: OpenItem) => (a.since ?? 0) - (b.since ?? 0);

  let inProgress = openTasks
    .filter((t) => (ACTIVE_STATUSES as readonly string[]).includes(t.status))
    .map(toOpenItem)
    .sort(byAge);

  let queued = openTasks
    .filter((t) => (QUEUED_STATUSES as readonly string[]).includes(t.status))
    .map(toOpenItem)
    .sort(byAge);

  let pending = openTasks
    .filter((t) => (PENDING_STATUSES as readonly string[]).includes(t.status))
    .map(toOpenItem)
    .sort(byAge);

  let blocked = openTasks
    .filter((t) => (BLOCKED_STATUSES as readonly string[]).includes(t.status))
    .map(toOpenItem)
    .sort(byAge);

  // --- ENTRÓ ESTA SEMANA --------------------------------------------------
  // Carga no planificada: lo que apareció después de tu último catch-up.
  // Es el bloque que justifica por qué no avanzó otra cosa.
  let incoming = scoped
    .filter((t) => t.createdAt >= from && t.createdAt < to)
    .map((t) => ({
      taskId: t._id,
      title: t.title,
      status: t.status,
      createdAt: t.createdAt,
      requestedBy: t.requestedBy ?? null,
      /** Vino de ClickUp (te la asignaron) vs. la creaste vos. */
      fromClickup: !!t.clickupId,
      /** Ya se cerró dentro de la misma semana en que entró. */
      closedSameWeek: doneIds.has(t._id),
      ...placementOf(t),
    }))
    .sort((a, b) => a.createdAt - b.createdAt);

  // --- MOVIMIENTOS (solo desde la bitácora) -------------------------------
  let moves = scopedEvents
    .filter((e) => e.kind === "status" || e.kind === "reopened")
    .map((e) => ({
      taskId: e.taskId,
      title: e.title,
      at: e.at,
      from: e.fromStatus ?? null,
      to: e.toStatus ?? null,
      reopened: e.kind === "reopened",
    }))
    .sort((a, b) => a.at - b.at);

  // --- TEMAS PARA CONVERSAR (pin manual) ----------------------------------
  let talkingPoints = live
    .filter((t) => t.catchupFlag)
    .map((t) => ({
      taskId: t._id,
      title: t.title,
      status: t.status,
      note: t.catchupNote ?? null,
      flaggedAt: t.catchupFlaggedAt ?? null,
      ...placementOf(t),
    }))
    .sort((a, b) => (b.flaggedAt ?? 0) - (a.flaggedAt ?? 0));

  // --- IMPREVISTOS (panel Hoy) --------------------------------------------
  // Surgidos en la ventana: cuántos y cuáles. No son tasks (tabla propia),
  // así que no aplica el scope de áreas ni las exclusiones. El "resuelto el
  // mismo día" lo calcula el CLIENTE con date-fns en hora local (dueño del
  // calendario, patrón de todo el catch-up); acá solo viajan crudos.
  const unplannedRows = await ctx.db
    .query("imprevistos")
    .withIndex("by_day", (q) => q.gte("day", from).lt("day", to))
    .collect();
  const unplanned = unplannedRows
    .filter((r) => r.deletedAt === undefined)
    .map((r) => ({
      id: r._id,
      title: r.title,
      day: r.day,
      resolvedAt: r.resolvedAt ?? null,
      promotedAt: r.promotedAt ?? null,
    }))
    .sort((a, b) => a.day - b.day);

  // --- EXCLUSIONES (la X de la vista) --------------------------------------
  // Tareas quitadas a mano del resumen de ESTA semana: no se listan ni
  // cuentan en las métricas. La tarea sigue viva en el tablero y en ClickUp.
  const excl = await readExclusions(ctx, from);
  if (excl.size > 0) {
    const keep = <T extends { taskId: string }>(arr: T[]) =>
      arr.filter((x) => !excl.has(x.taskId));
    done = keep(done);
    inProgress = keep(inProgress);
    queued = keep(queued);
    pending = keep(pending);
    blocked = keep(blocked);
    incoming = keep(incoming);
    talkingPoints = keep(talkingPoints);
  }

  // --- MÉTRICAS -----------------------------------------------------------
  const subtasksClosed = Array.from(subtasksClosedByTask.values()).reduce(
    (acc, l) => acc + l.length,
    0,
  );

  // Delta vs. la semana anterior: su ventana REAL es [from-7d, from+1d) —
  // martes a martes+1 con el solape del día ancla (ver catchupConfig).
  // Días calendario, no milisegundos, para sobrevivir al cambio de hora.
  // Aplican las exclusiones de ESA semana, no las de esta.
  const f = new Date(from);
  const prevFrom = new Date(f.getFullYear(), f.getMonth(), f.getDate() - 7).setHours(0, 0, 0, 0);
  const prevTo = new Date(f.getFullYear(), f.getMonth(), f.getDate() + 1).setHours(0, 0, 0, 0);
  const prevExcl = await readExclusions(ctx, prevFrom);
  const prevDone = scoped.filter(
    (t) =>
      t.completedAt !== undefined &&
      t.completedAt >= prevFrom &&
      t.completedAt < prevTo &&
      !prevExcl.has(String(t._id)),
  ).length;

  return {
    from,
    to,
    metrics: {
      completed: done.length,
      completedPrevWeek: prevDone,
      created: incoming.length,
      inProgress: inProgress.length,
      /** Urgentes: esperando que las tomes, no en marcha. */
      queued: queued.length,
      /** Backlog vivo, sin urgencia declarada. */
      pending: pending.length,
      blocked: blocked.length,
      /**
       * Ya no se muestra en la vista (inflaba el titular con una unidad que no
       * es comparable a una tarea), pero se sigue calculando: los snapshots
       * viejos lo tienen y sacarlo del tipo los volvería ilegibles.
       */
      subtasksClosed,
      /** Cuántas de las que entraron esta semana ya se cerraron. */
      closedSameWeek: incoming.filter((i) => i.closedSameWeek).length,
      /** Imprevistos del panel Hoy surgidos en la ventana. */
      unplanned: unplanned.length,
    },
    done,
    inProgress,
    queued,
    pending,
    blocked,
    incoming,
    moves,
    talkingPoints,
    unplanned,
  };
}

export type WeekSummary = Awaited<ReturnType<typeof buildSummary>>;

/**
 * Resuelve si un compromiso de la semana pasada se cumplió, mirando el estado
 * actual de la tarea enlazada.
 *
 * Deliberadamente NO te pregunta si lo cumpliste: la app ya lo sabe. Un
 * compromiso enlazado a una tarea se resuelve solo; uno suelto (sin tarea) es
 * el único que se marca a mano.
 */
async function resolveCommitments(
  ctx: QueryCtx,
  commitments: Doc<"catchups">["commitments"],
  windowFrom: number,
): Promise<ResolvedCommitment[]> {
  const out: ResolvedCommitment[] = [];
  for (const c of commitments) {
    const base = {
      id: c.id,
      rootId: rootIdOf(c),
      text: c.text,
      taskId: (c.taskId as string | undefined) ?? null,
      carryCount: c.carryCount ?? 0,
    };

    if (!c.taskId) {
      out.push({
        ...base,
        outcome: c.manualDone ? "done" : "stalled",
        reason: c.manualDone
          ? "Marcado como cumplido"
          : "Sin tarea enlazada, sin marcar",
      });
      continue;
    }

    const task = await ctx.db.get(c.taskId as Id<"tasks">);
    if (!task || task.deletedAt !== undefined) {
      out.push({
        ...base,
        outcome: "gone",
        reason: "La tarea ya no está en el tablero",
      });
      continue;
    }

    if (task.status === "completado") {
      out.push({ ...base, outcome: "done", reason: "Tarea completada" });
      continue;
    }

    // ¿Se movió algo desde que asumiste el compromiso? Cualquier evento
    // posterior al inicio de la ventana cuenta como movimiento real.
    const evs = await ctx.db
      .query("events")
      .withIndex("by_task", (q) => q.eq("taskId", c.taskId as Id<"tasks">))
      .collect();
    const moved = evs.some((e) => e.at >= windowFrom);

    out.push({
      ...base,
      outcome: moved ? "progress" : "stalled",
      reason: moved
        ? `En curso — hubo movimiento (${task.status})`
        : `Sin movimiento desde el último catch-up (${task.status})`,
    });
  }
  return out;
}

/**
 * Parsea un snapshot congelado. Devuelve null si está corrupto en vez de
 * lanzar: una fila mala no puede tumbar la bitácora entera.
 */
/** Snapshot congelado; `headline` existe desde la vista 2.0 (opcional). */
export type FrozenSnapshot = WeekSummary & { headline?: string };

function parseSnapshot(raw: string): FrozenSnapshot | null {
  try {
    return JSON.parse(raw) as FrozenSnapshot;
  } catch {
    return null;
  }
}

// ============================================================
//  QUERIES
// ============================================================

/**
 * Todo lo que necesita la vista Catch-up para una ventana dada.
 *
 * `from`/`to` los calcula el cliente en hora local (ver `catchupConfig.ts`).
 */
export const getWeek = query({
  args: { ...sessionArg, from: v.number(), to: v.number() },
  handler: async (ctx, { sessionToken, from, to }) => {
    await requireAuth(ctx, sessionToken);
    if (!(to > from)) throw new Error("Ventana de catch-up inválida");

    const summary = await buildSummary(ctx, from, to);

    // ¿Esta semana ya se cerró?
    const closed = await ctx.db
      .query("catchups")
      .withIndex("by_weekStart", (q) => q.eq("weekStart", from))
      .first();

    // El catch-up cerrado inmediatamente anterior: de ahí salen los
    // compromisos que se muestran arriba de todo ("Semana anterior").
    const allClosed = await ctx.db.query("catchups").collect();
    const previous = allClosed
      .filter((c) => c.weekStart < from)
      .sort((a, b) => b.weekStart - a.weekStart)[0];

    return {
      ...summary,
      anchorDay: await readAnchorDay(ctx),
      closed: closed
        ? {
            id: closed._id as string,
            closedAt: closed.closedAt,
            notes: closed.notes ?? null,
            commitments: await resolveCommitments(ctx, closed.commitments, from),
            /**
             * El resumen TAL COMO SE PRESENTÓ ese día.
             *
             * Sin esto, navegar a una semana pasada mostraba los bloques "En
             * curso" y "Detenido" recalculados con el tablero de HOY: parecía
             * histórico y no lo era. Un error silencioso, del peor tipo, porque
             * la pantalla no daba ninguna pista de que estaba mintiendo.
             */
            snapshot: parseSnapshot(closed.snapshot),
          }
        : null,
      previous: previous
        ? {
            // El id viaja para poder marcar a mano los compromisos sin tarea
            // enlazada desde el bloque "Semana anterior".
            id: previous._id as string,
            weekStart: previous.weekStart,
            weekEnd: previous.weekEnd,
            closedAt: previous.closedAt,
            notes: previous.notes ?? null,
            // Los compromisos de la semana pasada se resuelven contra ESTA
            // ventana: "¿se movió desde que lo prometiste?"
            commitments: await resolveCommitments(
              ctx,
              previous.commitments,
              previous.weekStart,
            ),
          }
        : null,
    };
  },
});

/** Lista los catch-ups cerrados (la bitácora), del más reciente al más viejo. */
export const history = query({
  args: sessionArg,
  handler: async (ctx, { sessionToken }) => {
    await requireAuth(ctx, sessionToken);
    const rows = await ctx.db.query("catchups").collect();
    return rows
      .sort((a, b) => b.weekStart - a.weekStart)
      .map((c) => {
        // El snapshot se guarda como JSON string. Si alguna vez quedara
        // corrupto, la bitácora no debe caerse entera por una fila mala.
        let metrics: Record<string, number> | null = null;
        let headline: string | null = null;
        try {
          const snap = JSON.parse(c.snapshot);
          metrics = snap?.metrics ?? null;
          headline = snap?.headline ?? null;
        } catch {
          metrics = null;
        }
        return {
          id: c._id as string,
          weekStart: c.weekStart,
          weekEnd: c.weekEnd,
          closedAt: c.closedAt,
          notes: c.notes ?? null,
          commitmentCount: c.commitments.length,
          metrics,
          headline,
        };
      });
  },
});

/** Abre un catch-up cerrado en solo lectura, tal como se presentó ese día. */
export const getClosed = query({
  args: { ...sessionArg, id: v.id("catchups") },
  handler: async (ctx, { sessionToken, id }) => {
    await requireAuth(ctx, sessionToken);
    const row = await ctx.db.get(id);
    if (!row) return null;
    const snapshot = parseSnapshot(row.snapshot);
    return {
      id: row._id as string,
      weekStart: row.weekStart,
      weekEnd: row.weekEnd,
      closedAt: row.closedAt,
      notes: row.notes ?? null,
      snapshot,
      commitments: await resolveCommitments(ctx, row.commitments, row.weekStart),
    };
  },
});

/**
 * Cadena de compromisos: el linaje completo de cada promesa a través de las
 * semanas.
 *
 * ===== POR QUÉ ESTA VISTA EXISTE =====
 * Sin ella, la bitácora es una pila de semanas sueltas y el arrastre solo se
 * ve de a una semana por vez. "Esto lo vienes prometiendo hace cinco martes"
 * es una frase que la app puede decir y vos no puedes reconstruir de memoria —
 * y es exactamente la que más te conviene decir vos antes que tu jefatura.
 *
 * Un compromiso puede terminar de tres maneras, y las tres importan:
 *  - **cumplido**: la tarea enlazada se completó (o lo marcaste a mano).
 *  - **abierto**: sigue vivo en el último catch-up cerrado.
 *  - **abandonado**: dejó de aparecer sin haberse cumplido. Esto es lo que
 *    normalmente se pierde: no falla ruidosamente, simplemente desaparece.
 */
export const chain = query({
  args: sessionArg,
  handler: async (ctx, { sessionToken }) => {
    await requireAuth(ctx, sessionToken);
    const rows = (await ctx.db.query("catchups").collect()).sort(
      (a, b) => a.weekStart - b.weekStart,
    );
    if (rows.length === 0) return [];
    const latestWeekStart = rows[rows.length - 1].weekStart;

    interface Appearance {
      weekStart: number;
      weekEnd: number;
      closedAt: number;
      carryCount: number;
      text: string;
    }
    const chains = new Map<
      string,
      {
        rootId: string;
        appearances: Appearance[];
        taskId?: Id<"tasks">;
        manualDone: boolean;
      }
    >();

    for (const row of rows) {
      for (const c of row.commitments) {
        const key = rootIdOf(c);
        const entry = chains.get(key) ?? {
          rootId: key,
          appearances: [],
          taskId: undefined as Id<"tasks"> | undefined,
          manualDone: false,
        };
        entry.appearances.push({
          weekStart: row.weekStart,
          weekEnd: row.weekEnd,
          closedAt: row.closedAt,
          carryCount: c.carryCount ?? 0,
          text: c.text,
        });
        // La tarea enlazada y la marca manual se toman de la aparición MÁS
        // RECIENTE: si enlazaste la tarea recién en la tercera semana, esa es
        // la información buena.
        if (c.taskId) entry.taskId = c.taskId;
        if (c.manualDone) entry.manualDone = true;
        chains.set(key, entry);
      }
    }

    const out = [];
    for (const entry of chains.values()) {
      const last = entry.appearances[entry.appearances.length - 1];
      const stillLive = last.weekStart === latestWeekStart;

      const task = entry.taskId ? await ctx.db.get(entry.taskId) : null;
      const alive = !!task && task.deletedAt === undefined;

      const { outcome, reason } = classifyChain({
        stillLive,
        taskCompleted: alive && task.status === "completado",
        manualDone: entry.manualDone,
        taskAlive: alive,
        taskStatus: task?.status,
      });

      out.push({
        rootId: entry.rootId,
        /** Último texto: si lo reformulaste, vale la versión más reciente. */
        text: last.text,
        taskId: (entry.taskId as string | undefined) ?? null,
        appearances: entry.appearances,
        weeks: entry.appearances.length,
        firstWeek: entry.appearances[0].weekStart,
        lastWeek: last.weekStart,
        outcome,
        reason,
      });
    }

    // Lo más arrastrado primero: es lo que hay que mirar.
    return out.sort(
      (a, b) => b.weeks - a.weeks || b.lastWeek - a.lastWeek,
    );
  },
});

/**
 * Serie temporal para el gráfico de la bitácora.
 *
 * ===== CÓMO SE MIDE EL CUMPLIMIENTO =====
 * No se pregunta "¿la tarea está completada hoy?", porque eso premiaría un
 * compromiso cumplido tres meses tarde como si se hubiera cumplido a tiempo.
 * Se mira qué decidiste vos en el catch-up SIGUIENTE:
 *
 *  - si el compromiso volvió a aparecer arrastrado → no se cumplió;
 *  - si desapareció y la tarea está completada (o lo marcaste) → se cumplió;
 *  - si desapareció sin cerrarse → no se cumplió (se abandonó).
 *
 * La semana más reciente no tiene un "siguiente" contra el cual medirse, así
 * que devuelve `rate: null` y el gráfico la dibuja como pendiente en vez de
 * inventarle un 0% que arruinaría la tendencia.
 */
export const trend = query({
  args: { ...sessionArg, weeks: v.optional(v.number()) },
  handler: async (ctx, { sessionToken, weeks }) => {
    await requireAuth(ctx, sessionToken);
    const limit = Math.max(1, Math.min(52, Math.floor(weeks ?? 12)));
    const all = (await ctx.db.query("catchups").collect()).sort(
      (a, b) => a.weekStart - b.weekStart,
    );

    const out = [];
    for (let i = 0; i < all.length; i++) {
      const row = all[i];
      const next = all[i + 1];
      const snap = parseSnapshot(row.snapshot);

      const total = row.commitments.length;
      let done = 0;
      if (next) {
        // Se resuelven las tareas ANTES de contar: `countFulfilled` es puro y
        // no puede leer la base, que es precisamente lo que lo hace testeable.
        const completedIds = new Set<string>();
        for (const c of row.commitments) {
          if (!c.taskId) continue;
          const task = await ctx.db.get(c.taskId);
          if (task && task.deletedAt === undefined && task.status === "completado") {
            completedIds.add(c.taskId);
          }
        }
        done = countFulfilled(
          row.commitments,
          new Set(next.commitments.map(rootIdOf)),
          (taskId) => completedIds.has(taskId),
        );
      }

      out.push({
        weekStart: row.weekStart,
        weekEnd: row.weekEnd,
        completed: snap?.metrics.completed ?? 0,
        subtasksClosed: snap?.metrics.subtasksClosed ?? 0,
        commitmentsTotal: total,
        commitmentsDone: next ? done : null,
        /** 0..1, o null si todavía no hay semana siguiente que la evalúe. */
        rate: next && total > 0 ? done / total : null,
      });
    }

    return out.slice(-limit);
  },
});

/** Día de la semana configurado para el catch-up (0=domingo … 6=sábado). */
export const getAnchorDay = query({
  args: sessionArg,
  handler: async (ctx, { sessionToken }) => {
    await requireAuth(ctx, sessionToken);
    return await readAnchorDay(ctx);
  },
});

// ============================================================
//  MUTATIONS
// ============================================================

/** Cambia el día en que ocurre tu catch-up. */
export const setAnchorDay = mutation({
  args: { ...sessionArg, day: v.number() },
  handler: async (ctx, { sessionToken, day }) => {
    await requireAuth(ctx, sessionToken);
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new Error("Día inválido: debe ser 0 (domingo) a 6 (sábado)");
    }
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY_CATCHUP_DAY))
      .first();
    const now = Date.now();
    if (row) {
      await ctx.db.patch(row._id, { value: String(day), updatedAt: now });
    } else {
      await ctx.db.insert("settings", {
        key: SETTINGS_KEY_CATCHUP_DAY,
        value: String(day),
        updatedAt: now,
      });
    }
  },
});

/**
 * Cierra la semana: congela el resumen y guarda los compromisos para la
 * siguiente.
 *
 * El snapshot se calcula acá, en el servidor, en el mismo instante del cierre.
 * No se acepta uno enviado por el cliente: lo que quedó registrado tiene que
 * ser lo que el tablero decía, no lo que el navegador creía.
 *
 * Cerrar dos veces la misma semana la SOBREESCRIBE en vez de duplicarla, para
 * que corregir un compromiso mal escrito no ensucie la bitácora.
 */
export const close = mutation({
  args: {
    ...sessionArg,
    from: v.number(),
    to: v.number(),
    notes: v.optional(v.string()),
    commitments: v.array(
      v.object({
        id: v.string(),
        text: v.string(),
        taskId: v.optional(v.id("tasks")),
        manualDone: v.optional(v.boolean()),
        carryCount: v.optional(v.number()),
        rootId: v.optional(v.string()),
      }),
    ),
    /**
     * Si limpiar los pines "llevar al catch-up" al cerrar. Por defecto sí:
     * ya los conversaste, arrancar la semana nueva con la lista vieja haría
     * que el bloque pierda todo su valor de señal.
     */
    clearFlags: v.optional(v.boolean()),
    /**
     * La frase ejecutiva de la semana, tal como se mostraba al cerrar. Se
     * congela dentro del snapshot: abrir una semana vieja debe mostrar la
     * frase que se presentó ese día, no un recálculo.
     */
    headline: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.sessionToken);
    const { from, to } = args;
    if (!(to > from)) throw new Error("Ventana de catch-up inválida");
    if (args.commitments.length > COMMITMENTS_MAX) {
      throw new Error(
        `Máximo ${COMMITMENTS_MAX} compromisos: si son más, no son compromisos, es una lista de tareas`,
      );
    }

    const commitments = args.commitments
      .map((c) => ({
        ...c,
        text: c.text.trim().slice(0, COMMITMENT_MAX),
        carryCount: Math.max(0, Math.floor(c.carryCount ?? 0)),
        // Un compromiso nuevo es la raíz de su propia cadena. Los arrastrados
        // llegan con el rootId del original, y así el linaje se mantiene
        // aunque reformules el texto en el camino.
        rootId: c.rootId ?? rootIdOf(c),
      }))
      .filter((c) => c.text.length > 0);

    const snapshot = JSON.stringify({
      ...(await buildSummary(ctx, from, to)),
      headline: args.headline?.trim().slice(0, 300) || undefined,
    });
    const now = Date.now();
    const notes = args.notes?.slice(0, NOTES_MAX);

    const existing = await ctx.db
      .query("catchups")
      .withIndex("by_weekStart", (q) => q.eq("weekStart", from))
      .first();

    let id: Id<"catchups">;
    if (existing) {
      await ctx.db.patch(existing._id, {
        weekEnd: to,
        closedAt: now,
        notes,
        snapshot,
        commitments,
        updatedAt: now,
      });
      id = existing._id;
    } else {
      id = await ctx.db.insert("catchups", {
        weekStart: from,
        weekEnd: to,
        closedAt: now,
        notes,
        snapshot,
        commitments,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (args.clearFlags !== false) {
      const flagged = await ctx.db.query("tasks").collect();
      await Promise.all(
        flagged
          .filter((t) => t.catchupFlag && t.deletedAt === undefined)
          .map((t) =>
            ctx.db.patch(t._id, {
              catchupFlag: false,
              catchupNote: undefined,
              catchupFlaggedAt: undefined,
              updatedAt: now,
            }),
          ),
      );
    }

    return id;
  },
});

/**
 * Lazy close: sella la semana anterior si su ventana ya venció y quedó sin
 * cerrar. La vista lo invoca al montarse; así el historial nunca tiene huecos
 * aunque nunca aprietes "Cerrar".
 *
 * Diferencias deliberadas con el cierre manual:
 *  - Los compromisos se ARRASTRAN solos (los no cumplidos, +1 arrastre);
 *    nadie los revisó, así que no se inventan otros.
 *  - NO se limpian los pines 📌: todavía no los conversaste.
 *  - El snapshot se guarda sin headline; la UI lo genera con las métricas
 *    congeladas (graceful degradation ya soportada).
 *  - Siempre puedes "Editar cierre" después: el auto-cierre no sella nada
 *    para siempre.
 *
 * Idempotente: si la semana ya está cerrada, no toca nada.
 */
export const ensurePreviousClosed = mutation({
  args: {
    ...sessionArg,
    /** Inicio de la semana a cerrar (la anterior a la que se está viendo). */
    prevFrom: v.number(),
    /** Fin de esa semana (exclusivo). Debe estar en el pasado. */
    prevTo: v.number(),
  },
  handler: async (ctx, { sessionToken, prevFrom, prevTo }) => {
    await requireAuth(ctx, sessionToken);
    if (!(prevTo > prevFrom)) throw new Error("Ventana inválida");

    // Solo semanas que ya terminaron. El lunes, la semana en curso sigue
    // abierta con su botón manual: esto no la toca.
    if (prevTo > Date.now()) return { closed: false, reason: "not-ended" };

    const existing = await ctx.db
      .query("catchups")
      .withIndex("by_weekStart", (q) => q.eq("weekStart", prevFrom))
      .first();
    if (existing) return { closed: false, reason: "already-closed" };

    // Arrastrar los compromisos no cumplidos del cierre inmediatamente
    // anterior (si existe), igual que haría el modal manual.
    const before = (await ctx.db.query("catchups").collect())
      .filter((c) => c.weekStart < prevFrom)
      .sort((a, b) => b.weekStart - a.weekStart)[0];
    let carried: { id: string; text: string; taskId?: Id<"tasks">; carryCount: number; rootId: string }[] = [];
    if (before) {
      const resolved = await resolveCommitments(ctx, before.commitments, before.weekStart);
      carried = resolved
        .filter((c) => c.outcome !== "done" && c.outcome !== "gone")
        .map((c) => ({
          id: `${c.id}-auto`,
          text: c.text.slice(0, COMMITMENT_MAX),
          taskId: (c.taskId as Id<"tasks"> | null) ?? undefined,
          carryCount: c.carryCount + 1,
          // El rootId NO cambia: une esta aparición con la original.
          rootId: c.rootId,
        }));
    }

    const snapshot = JSON.stringify(await buildSummary(ctx, prevFrom, prevTo));
    const now = Date.now();
    await ctx.db.insert("catchups", {
      weekStart: prevFrom,
      weekEnd: prevTo,
      closedAt: now,
      notes: undefined,
      snapshot,
      commitments: carried,
      createdAt: now,
      updatedAt: now,
    });

    return { closed: true };
  },
});

/**
 * Quita (o restaura) una tarea del resumen de UNA semana — la X de la vista.
 * Solo afecta esa ventana y sus contadores; la tarea no se toca en el tablero
 * ni en ClickUp. Al cerrar la semana, el snapshot se congela sin ella.
 * Idempotente.
 */
export const setExcluded = mutation({
  args: {
    ...sessionArg,
    weekStart: v.number(),
    taskId: v.id("tasks"),
    excluded: v.boolean(),
  },
  handler: async (ctx, { sessionToken, weekStart, taskId, excluded }) => {
    await requireAuth(ctx, sessionToken);
    const rows = await ctx.db
      .query("catchupExclusions")
      .withIndex("by_weekStart", (q) => q.eq("weekStart", weekStart))
      .collect();
    const mine = rows.filter((r) => r.taskId === taskId);
    if (excluded && mine.length === 0) {
      await ctx.db.insert("catchupExclusions", {
        weekStart,
        taskId,
        createdAt: Date.now(),
      });
    } else if (!excluded && mine.length > 0) {
      await Promise.all(mine.map((r) => ctx.db.delete(r._id)));
    }
    return { excluded };
  },
});

/**
 * Marca a mano un compromiso como cumplido.
 *
 * Solo tiene sentido para los compromisos SIN tarea enlazada ("hablar con
 * legales", "revisar el contrato"): los enlazados se resuelven solos y
 * permitir pisarlos a mano abriría la puerta a maquillar la métrica, que es
 * justo lo contrario de para lo que sirve.
 */
export const setCommitmentDone = mutation({
  args: {
    ...sessionArg,
    catchupId: v.id("catchups"),
    commitmentId: v.string(),
    done: v.boolean(),
  },
  handler: async (ctx, { sessionToken, catchupId, commitmentId, done }) => {
    await requireAuth(ctx, sessionToken);
    const row = await ctx.db.get(catchupId);
    if (!row) throw new Error("Catch-up no encontrado");

    const target = row.commitments.find((c) => c.id === commitmentId);
    if (!target) throw new Error("Compromiso no encontrado");
    if (target.taskId) {
      throw new Error(
        "Este compromiso está enlazado a una tarea: se cumple completando la tarea, no marcándolo acá",
      );
    }

    await ctx.db.patch(catchupId, {
      commitments: row.commitments.map((c) =>
        c.id === commitmentId ? { ...c, manualDone: done } : c,
      ),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Reabre una semana cerrada: borra la fila para poder cerrarla de nuevo.
 *
 * Los pines ya limpiados NO se restauran: el pin es una nota del momento y no
 * tiene sentido resucitarla. Se avisa en la UI antes de confirmar.
 */
export const reopen = mutation({
  args: { ...sessionArg, id: v.id("catchups") },
  handler: async (ctx, { sessionToken, id }) => {
    await requireAuth(ctx, sessionToken);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Catch-up no encontrado");
    await ctx.db.delete(id);
  },
});
