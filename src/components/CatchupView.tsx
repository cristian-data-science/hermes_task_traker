/**
 * CatchUp 2.0 — alta señal, baja carga cognitiva.
 *
 * La vista responde 3 preguntas en orden, sin scroll mental:
 *  1. ¿Cómo vengo?  → una frase ejecutiva + 3 números grandes
 *  2. ¿Qué hice?    → completado (los wins), compacto por día
 *  3. ¿Qué sigue y qué tengo que hablar? → en curso + detenidas + pineadas
 *
 * Y el cierre sella la semana: congela el snapshot CON la frase ejecutiva,
 * así abrir una semana vieja muestra exactamente lo que se presentó.
 *
 * Lo que NO está (a propósito): 6 métricas, bloques separados de en
 * cola/pendientes/reabierto/entraron, drawer de 3 pestañas y gráfico de
 * tendencia. Eso vivía en la versión 1 y se percibía como dashboard, no como
 * conversación. "En espera" queda como contador colapsable; lo demás vive en
 * la frase o en el texto copiado.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Archive,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  ClipboardCheck,
  Copy,
  History,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Settings2,
  Square,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import toast from "react-hot-toast";
import type { Doc, Id } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import {
  weekWindow,
  startOfCurrentWeek,
  shiftWeek,
  formatWindowLabel,
  DAY_LABELS,
} from "~/convex/catchupConfig";
import { useAuth } from "../hooks/useAuth";
import {
  buildCatchupText,
  buildHeadline,
  queuedOf,
  pendingOf,
  type WeekData,
  type WeekBody,
} from "../lib/catchupSummary";
import { cn } from "../lib/utils";

interface CatchupViewProps {
  /** Tareas vivas, para abrir el modal de edición desde el resumen. */
  tasks: Doc<"tasks">[];
  onEditTask: (task: Doc<"tasks">) => void;
}

/** Borrador de compromiso mientras se edita en el modal de cierre. */
interface CommitmentDraft {
  id: string;
  text: string;
  taskId?: Id<"tasks">;
  carryCount: number;
  /** Identidad estable a través de los arrastres (para el linaje). */
  rootId: string;
}

const DAY_MS = 86400000;

export function CatchupView({ tasks, onEditTask }: CatchupViewProps) {
  const { token } = useAuth();
  const anchorDay = useQuery(
    api.catchups.getAnchorDay,
    token ? { sessionToken: token } : "skip",
  );

  /** 0 = semana en curso, -1 = la anterior, etc. */
  const [offset, setOffset] = useState(0);
  const [closing, setClosing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [daySettingOpen, setDaySettingOpen] = useState(false);

  // La ventana se calcula en el CLIENTE, en hora local (ver catchupConfig.ts).
  const { from, to } = useMemo(() => {
    const day = anchorDay ?? 2;
    return weekWindow(shiftWeek(startOfCurrentWeek(day), offset));
  }, [anchorDay, offset]);

  const data = useQuery(
    api.catchups.getWeek,
    token && anchorDay !== undefined
      ? { sessionToken: token, from, to }
      : "skip",
  );

  const frozen = !!data?.closed?.snapshot;
  const [showFrozen, setShowFrozen] = useState(true);

  /**
   * Lazy close: al abrir la vista, sellar la semana anterior si venció sin
   * cerrar (arrastre automático de compromisos, pines intactos). El botón
   * manual sigue disponible para la semana en curso — esto nunca la toca.
   * Idempotente y con guard para no repetir la llamada por semana vista.
   */
  const ensureClosed = useMutation(api.catchups.ensurePreviousClosed);
  const ensuredFor = useRef<number | null>(null);
  useEffect(() => {
    if (!token || offset !== 0 || ensuredFor.current === from) return;
    ensuredFor.current = from;
    const span = to - from;
    void ensureClosed({
      sessionToken: token,
      prevFrom: from - span,
      prevTo: from,
    })
      .then((r) => {
        if ((r as { closed: boolean }).closed) {
          toast.success("Semana anterior cerrada automáticamente");
        }
      })
      .catch(() => {
        // Silencioso: si falla, el cierre manual sigue disponible.
      });
  }, [token, offset, from, to, ensureClosed]);

  const windowLabel = formatWindowLabel(from, to);
  const isCurrent = offset === 0;

  if (!data) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  const week = data;
  const body: WeekBody =
    frozen && showFrozen ? week.closed!.snapshot! : (week as WeekBody);

  /** La frase: la congelada si hay snapshot, si no la calculada en vivo. */
  const headline =
    frozen && showFrozen && week.closed?.snapshot?.headline
      ? week.closed.snapshot.headline
      : buildHeadline(body);

  function copySummary() {
    const text = buildCatchupText(week as WeekData, {
      windowLabel,
      body,
      notes: week.closed?.notes ?? undefined,
    });
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success("Resumen copiado"))
      .catch(() => toast.error("No se pudo copiar al portapapeles"));
  }

  return (
    <div className="mx-auto max-w-[860px] pb-16">
      {/* ===== Cabecera ===== */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setOffset((o) => o - 1)}
            className="btn-ghost p-2"
            title="Semana anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
            disabled={isCurrent}
            className="btn-ghost p-2"
            title="Semana siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div>
          <h2 className="font-display text-lg font-bold capitalize text-ink">
            {windowLabel}
          </h2>
          <p className="text-xs text-faint">
            {isCurrent ? "Semana en curso" : "Semana pasada"}
            {data.closed &&
              ` · cerrado el ${format(new Date(data.closed.closedAt), "d MMM", { locale: es })}`}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={copySummary} className="btn btn-secondary gap-1.5 text-xs">
            <Copy className="h-3.5 w-3.5" />
            Copiar
          </button>
          <button
            onClick={() => setHistoryOpen(true)}
            className="btn-ghost p-2"
            title="Semanas cerradas"
          >
            <History className="h-4 w-4" />
          </button>
          <button
            onClick={() => setDaySettingOpen((v) => !v)}
            className="btn-ghost p-2"
            title="Día del catch-up"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setClosing(true)}
            className={cn("btn gap-1.5 text-xs", data.closed ? "btn-secondary" : "btn-primary")}
          >
            {data.closed ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            {data.closed ? "Editar cierre" : "Cerrar"}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {daySettingOpen && (
          <AnchorDayPicker current={anchorDay ?? 2} onDone={() => setDaySettingOpen(false)} />
        )}
      </AnimatePresence>

      {/* ===== 1. Frase ejecutiva ===== */}
      <div className="mb-4 rounded-el-lg border-el border-accent/30 bg-accent/5 px-4 py-3.5">
        <div className="flex items-start gap-2.5">
          <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p className="text-[15px] font-medium leading-snug text-ink">{headline}</p>
        </div>
      </div>

      {/* ===== 2. Tres números ===== */}
      <ChipsRow body={body} />

      {/* ===== 3. Venís de… ===== */}
      {data.previous && data.previous.commitments.length > 0 && (
        <PreviousBlock previous={data.previous} tasks={tasks} onEditTask={onEditTask} />
      )}

      {/* Aviso + toggle cuando la semana está cerrada */}
      {frozen && (
        <FrozenBanner
          mode={showFrozen ? "frozen" : "today"}
          closedAt={data.closed!.closedAt}
          onToggle={() => setShowFrozen((v) => !v)}
        />
      )}

      {/* ===== 4. El cuerpo ===== */}
      <DoneSection done={body.done} tasks={tasks} onEditTask={onEditTask} />
      <ActiveSection
        inProgress={body.inProgress}
        blocked={body.blocked}
        waiting={[...queuedOf(body), ...pendingOf(body)]}
        moves={body.moves}
        tasks={tasks}
        onEditTask={onEditTask}
      />
      <TalkingSection points={body.talkingPoints} tasks={tasks} onEditTask={onEditTask} />

      <AnimatePresence>
        {closing && (
          <CloseModal
            data={data as WeekData}
            from={from}
            to={to}
            windowLabel={windowLabel}
            tasks={tasks}
            onClose={() => setClosing(false)}
          />
        )}
        {historyOpen && (
          <HistoryDrawer
            currentFrom={weekWindow(startOfCurrentWeek(anchorDay ?? 2)).from}
            onJump={(weekStart) => {
              setHistoryOpen(false);
              const current = weekWindow(startOfCurrentWeek(anchorDay ?? 2)).from;
              setOffset(Math.round((weekStart - current) / (7 * DAY_MS)));
            }}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
//  FRASE + CHIPS
// ============================================================

/** Los 3 números que importan: cerradas (con delta), en curso, detenidas. */
function ChipsRow({ body }: { body: WeekBody }) {
  const m = body.metrics;
  const delta = m.completed - m.completedPrevWeek;

  const chips = [
    {
      label: "completadas",
      value: m.completed,
      foot:
        delta === 0
          ? "igual que la anterior"
          : `${delta > 0 ? "+" : ""}${delta} vs anterior`,
      tone: delta >= 0 ? "ok" : "bad",
    },
    {
      label: "en curso",
      value: m.inProgress,
      foot: `${(m.queued ?? 0) + (m.pending ?? 0)} más en espera`,
      tone: "neutral",
    },
    {
      label: "detenidas",
      value: m.blocked,
      foot: m.blocked > 0 ? "requieren atención" : "nada trabado",
      tone: m.blocked > 0 ? "bad" : "ok",
    },
  ] as const;

  return (
    <div className="mb-6 grid grid-cols-3 gap-2">
      {chips.map((c) => (
        <div
          key={c.label}
          className={cn(
            "rounded-el-lg border-el px-3 py-2.5 text-center",
            c.tone === "bad" && c.value > 0
              ? "border-danger/40 bg-danger/5"
              : "border-line bg-panel",
          )}
        >
          <p
            className={cn(
              "font-display text-2xl font-bold leading-none",
              c.tone === "bad" && c.value > 0 ? "text-danger" : "text-ink",
            )}
          >
            {c.value}
          </p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-mute">
            {c.label}
          </p>
          <p className="text-[10px] text-faint">{c.foot}</p>
        </div>
      ))}
    </div>
  );
}

// ============================================================
//  SECCIONES
// ============================================================

/** Contenedor común de cada sección. */
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
          {title}
        </h3>
        {count !== undefined && (
          <span className="text-xs font-semibold text-faint">({count})</span>
        )}
      </div>
      {children}
    </section>
  );
}

/** Fila compacta de una tarea: título + lugar + edad. Click abre el modal. */
function TaskRow({
  title,
  project,
  ancestors,
  clickupUrl,
  right,
  sub,
  task,
  onEditTask,
  danger,
}: {
  title: string;
  project: string | null;
  ancestors: string[];
  clickupUrl: string | null;
  right?: React.ReactNode;
  sub?: string;
  task?: Doc<"tasks">;
  onEditTask: (t: Doc<"tasks">) => void;
  danger?: boolean;
}) {
  const where = [project, ...ancestors].filter(Boolean);
  const place = where.length <= 2 ? where.join(" › ") : `${where[0]} › … › ${where[where.length - 1]}`;
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-line px-3 py-2 last:border-0",
        task && "cursor-pointer hover:bg-panel2",
      )}
      onClick={() => task && onEditTask(task)}
    >
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm text-ink", danger && "font-medium")}>{title}</p>
        <p className="truncate text-[11px] text-faint">
          {place}
          {sub && ` · ${sub}`}
        </p>
      </div>
      {clickupUrl && (
        <a
          href={clickupUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 text-[10px] text-accent hover:underline"
        >
          ClickUp
        </a>
      )}
      {right}
    </div>
  );
}

/** Días que lleva una tarea en su estado, honesto con sinceKind. */
function ageLabel(since: number | null, sinceKind: string): string {
  if (since === null) return "";
  const d = Math.max(0, Math.floor((Date.now() - since) / DAY_MS));
  if (d === 0) return "hoy";
  const approx = sinceKind === "created" ? "~" : "";
  return `${approx}${d} días`;
}

/** Compromisos de la semana anterior, ya resueltos. */
function PreviousBlock({
  previous,
  tasks,
  onEditTask,
}: {
  previous: NonNullable<WeekData["previous"]>;
  tasks: Doc<"tasks">[];
  onEditTask: (t: Doc<"tasks">) => void;
}) {
  const { token } = useAuth();
  const setDone = useMutation(api.catchups.setCommitmentDone);
  const done = previous.commitments.filter((c) => c.outcome === "done").length;

  return (
    <Section title="Venís de" count={previous.commitments.length}>
      <p className="mb-1.5 text-xs text-mute">
        {done}/{previous.commitments.length} compromisos cumplidos
      </p>
      <div className="overflow-hidden rounded-el border-el border-line bg-panel shadow-el">
        {previous.commitments.map((c) => {
          const task = c.taskId ? tasks.find((t) => t._id === c.taskId) : undefined;
          const manual = c.taskId === null;
          const mark =
            c.outcome === "done" ? (
              manual ? (
                <CheckSquare className="h-4 w-4 text-emerald-500" />
              ) : (
                <Check className="h-4 w-4 text-emerald-500" />
              )
            ) : manual ? (
              <Square className="h-4 w-4 text-faint" />
            ) : c.outcome === "progress" ? (
              <CircleDashed className="h-4 w-4 text-amber-500" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-danger" />
            );
          return (
            <div
              key={c.id}
              className={cn(
                "flex items-start gap-2.5 border-b border-line px-3 py-2 last:border-0",
                task && "cursor-pointer hover:bg-panel2",
              )}
              onClick={() => task && onEditTask(task)}
            >
              {manual ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!token) return;
                    void setDone({
                      sessionToken: token,
                      catchupId: previous.id as Id<"catchups">,
                      commitmentId: c.id,
                      done: c.outcome !== "done",
                    }).catch((err: unknown) =>
                      toast.error(err instanceof Error ? err.message : "No se pudo marcar"),
                    );
                  }}
                  title="Marcar como cumplido"
                  className="mt-0.5 shrink-0 transition-transform hover:scale-110"
                >
                  {mark}
                </button>
              ) : (
                <span className="mt-0.5 shrink-0">{mark}</span>
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm text-ink",
                    c.outcome === "done" && "text-mute line-through",
                  )}
                >
                  {c.text}
                </p>
                <p className="text-[11px] text-faint">{c.reason}</p>
              </div>
              {c.carryCount > 0 && (
                <span className="shrink-0 rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger">
                  arrastrado ×{c.carryCount}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function FrozenBanner({
  mode,
  closedAt,
  onToggle,
}: {
  mode: "frozen" | "today";
  closedAt: number;
  onToggle: () => void;
}) {
  const isFrozen = mode === "frozen";
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-center gap-2 rounded-el border-el px-3 py-2",
        isFrozen ? "border-accent/40 bg-accent/5" : "border-amber-500/40 bg-amber-500/5",
      )}
    >
      {isFrozen ? (
        <Archive className="h-4 w-4 shrink-0 text-accent" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
      )}
      <p className="min-w-0 flex-1 text-xs text-ink">
        {isFrozen ? (
          <>
            <span className="font-semibold">Así lo presentaste</span> — congelado al cerrar, el{" "}
            {format(new Date(closedAt), "d 'de' MMMM 'a las' HH:mm", { locale: es })}.
          </>
        ) : (
          <>
            <span className="font-semibold">Estado de hoy</span> — refleja el tablero actual, no cómo estaba esa semana.
          </>
        )}
      </p>
      <button onClick={onToggle} className="btn btn-secondary shrink-0 gap-1.5 text-xs">
        <RefreshCw className="h-3.5 w-3.5" />
        {isFrozen ? "Ver cómo está hoy" : "Ver lo que presenté"}
      </button>
    </div>
  );
}

/** Completado esta semana, agrupado por día, 1 línea por tarea. */
function DoneSection({
  done,
  tasks,
  onEditTask,
}: {
  done: WeekBody["done"];
  tasks: Doc<"tasks">[];
  onEditTask: (t: Doc<"tasks">) => void;
}) {
  if (done.length === 0) {
    return (
      <Section title="Completado">
        <p className="rounded-el border-el border-line bg-panel px-3 py-3 text-sm text-mute">
          Nada cerrado en esta ventana.
        </p>
      </Section>
    );
  }
  // Agrupar por día.
  const byDay = new Map<string, WeekBody["done"]>();
  for (const d of done) {
    const key = format(new Date(d.at), "EEEE d 'de' MMMM", { locale: es });
    byDay.set(key, [...(byDay.get(key) ?? []), d]);
  }
  return (
    <Section title="Completado" count={done.length}>
      <div className="overflow-hidden rounded-el border-el border-line bg-panel shadow-el">
        {Array.from(byDay.entries()).map(([day, items]) => (
          <div key={day}>
            <p className="border-b border-line bg-panel2 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-faint">
              {day}
            </p>
            {items.map((d) => (
              <TaskRow
                key={d.taskId}
                title={d.title}
                project={d.project}
                ancestors={d.ancestors}
                clickupUrl={d.clickupUrl}
                sub={
                  d.subtasks.length > 0
                    ? `+${d.subtasks.length} subtareas`
                    : d.requestedBy
                      ? `pide: ${d.requestedBy}`
                      : undefined
                }
                task={d.stillExists ? tasks.find((t) => t._id === d.taskId) : undefined}
                onEditTask={onEditTask}
              />
            ))}
          </div>
        ))}
      </div>
    </Section>
  );
}

/** En curso + detenidas, y "en espera" colapsable. */
function ActiveSection({
  inProgress,
  blocked,
  waiting,
  moves,
  tasks,
  onEditTask,
}: {
  inProgress: WeekBody["inProgress"];
  blocked: WeekBody["blocked"];
  waiting: WeekBody["inProgress"];
  moves: WeekBody["moves"];
  tasks: Doc<"tasks">[];
  onEditTask: (t: Doc<"tasks">) => void;
}) {
  const [showWaiting, setShowWaiting] = useState(false);
  // Las reabiertas esta semana: badge puntual, no bloque aparte.
  const reopenedIds = useMemo(
    () => new Set(moves.filter((m) => m.reopened).map((m) => m.taskId as string)),
    [moves],
  );

  if (inProgress.length === 0 && blocked.length === 0 && waiting.length === 0) {
    return null;
  }

  const renderOpen = (t: WeekBody["inProgress"][number], isBlocked = false) => {
    const age = ageLabel(t.since, t.sinceKind);
    const subParts: string[] = [];
    if (t.progress !== null && t.progress > 0) subParts.push(`${t.progress}%`);
    if (t.advancedSubtasks.length > 0)
      subParts.push(`avanzó: +${t.advancedSubtasks.length} subtareas`);
    return (
      <TaskRow
        key={t.taskId}
        title={t.title}
        project={t.project}
        ancestors={t.ancestors}
        clickupUrl={t.clickupUrl}
        sub={subParts.join(" · ") || undefined}
        task={tasks.find((x) => x._id === t.taskId)}
        onEditTask={onEditTask}
        danger={isBlocked}
        right={
          <span className="flex shrink-0 items-center gap-1.5">
            {reopenedIds.has(t.taskId) && (
              <span
                className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-600"
                title="Reabierta esta semana"
              >
                ↩
              </span>
            )}
            {age && (
              <span
                className={cn(
                  "text-[10px] font-semibold",
                  isBlocked ? "text-danger" : "text-faint",
                )}
              >
                {age}
              </span>
            )}
          </span>
        }
      />
    );
  };

  return (
    <Section title="Abiertas" count={inProgress.length + blocked.length + waiting.length}>
      <div className="overflow-hidden rounded-el border-el border-line bg-panel shadow-el">
        {inProgress.map((t) => renderOpen(t))}
        {blocked.map((t) => renderOpen(t, true))}
      </div>

      {/* En espera: colapsable, es la cola que no genera conversación */}
      {waiting.length > 0 && (
        <button
          onClick={() => setShowWaiting((v) => !v)}
          className="mt-1.5 inline-flex items-center gap-1 text-xs text-mute hover:text-ink"
        >
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", !showWaiting && "-rotate-90")}
          />
          {waiting.length} en espera (urgentes + pendientes)
        </button>
      )}
      {showWaiting && waiting.length > 0 && (
        <div className="mt-1.5 overflow-hidden rounded-el border-el border-line bg-panel opacity-80 shadow-el">
          {waiting.map((t) => renderOpen(t))}
        </div>
      )}
    </Section>
  );
}

/** Las pineadas: lo que querés levantar en la conversación. */
function TalkingSection({
  points,
  tasks,
  onEditTask,
}: {
  points: WeekBody["talkingPoints"];
  tasks: Doc<"tasks">[];
  onEditTask: (t: Doc<"tasks">) => void;
}) {
  if (points.length === 0) return null;
  return (
    <Section title="Para conversar" count={points.length}>
      <div className="overflow-hidden rounded-el border-el border-line bg-panel shadow-el">
        {points.map((p) => (
          <TaskRow
            key={p.taskId}
            title={p.title}
            project={p.project}
            ancestors={p.ancestors}
            clickupUrl={p.clickupUrl}
            sub={p.note ?? undefined}
            task={tasks.find((t) => t._id === p.taskId)}
            onEditTask={onEditTask}
          />
        ))}
      </div>
    </Section>
  );
}

// ============================================================
//  MODAL DE CIERRE
// ============================================================

function CloseModal({
  data,
  from,
  to,
  windowLabel,
  tasks,
  onClose,
}: {
  data: WeekData;
  from: number;
  to: number;
  windowLabel: string;
  tasks: Doc<"tasks">[];
  onClose: () => void;
}) {
  const { token } = useAuth();
  const close = useMutation(api.catchups.close);
  const reopen = useMutation(api.catchups.reopen);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState(data.closed?.notes ?? "");

  const [drafts, setDrafts] = useState<CommitmentDraft[]>(() => {
    if (data.closed) {
      return data.closed.commitments.map((c) => ({
        id: c.id,
        text: c.text,
        taskId: (c.taskId as Id<"tasks"> | null) ?? undefined,
        carryCount: c.carryCount,
        rootId: c.rootId,
      }));
    }
    // Arrastrar lo pendiente de la semana pasada ("gone" no se arrastra).
    return (data.previous?.commitments ?? [])
      .filter((c) => c.outcome !== "done" && c.outcome !== "gone")
      .map((c) => ({
        id: `${c.id}-carry`,
        text: c.text,
        taskId: (c.taskId as Id<"tasks"> | null) ?? undefined,
        carryCount: c.carryCount + 1,
        rootId: c.rootId,
      }));
  });

  /** La frase que se congela: la del cálculo vivo de esta semana. */
  const headline = buildHeadline(data as WeekBody);

  const openTasks = useMemo(
    () => tasks.filter((t) => t.status !== "completado" && t.area === "patagonia"),
    [tasks],
  );

  async function submit() {
    if (!token) return;
    setSaving(true);
    try {
      await close({
        sessionToken: token,
        from,
        to,
        notes: notes.trim() || undefined,
        headline,
        commitments: drafts
          .filter((d) => d.text.trim())
          .map((d) => ({
            id: d.id,
            text: d.text.trim(),
            taskId: d.taskId,
            carryCount: d.carryCount,
            rootId: d.rootId,
          })),
      });
      toast.success("Catch-up cerrado");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo cerrar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-el-lg border-el border-line bg-canvas shadow-el-lg"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Lock className="h-4 w-4 text-accent" />
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-sm font-bold text-ink">
              Cerrar catch-up · {windowLabel}
            </h3>
            <p className="truncate text-[11px] text-faint">{headline}</p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="label">Compromisos para la próxima semana</p>
              <button
                onClick={() =>
                  setDrafts((d) => {
                    const id = `new-${Date.now()}-${d.length}`;
                    return [...d, { id, rootId: id, text: "", carryCount: 0 }];
                  })
                }
                className="btn-ghost gap-1 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Añadir
              </button>
            </div>
            {drafts.length === 0 && (
              <p className="rounded-el border-el border-line bg-panel px-3 py-2.5 text-xs text-mute">
                Sin compromisos. Añadí 3 a 5: es lo que la semana que viene se resuelve solo
                contra el tablero.
              </p>
            )}
            <div className="space-y-2">
              {drafts.map((d, i) => (
                <div
                  key={d.id}
                  className="rounded-el border-el border-line bg-panel p-2.5"
                >
                  <div className="flex items-start gap-2">
                    <input
                      value={d.text}
                      onChange={(e) =>
                        setDrafts((arr) =>
                          arr.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                        )
                      }
                      placeholder="Ej: dejar el alcance de Ley de Datos aprobado"
                      className="input flex-1 text-sm"
                    />
                    <button
                      onClick={() => setDrafts((arr) => arr.filter((_, j) => j !== i))}
                      className="btn-ghost p-1.5 text-faint hover:text-danger"
                      title="Quitar compromiso"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <select
                      value={d.taskId ?? ""}
                      onChange={(e) =>
                        setDrafts((arr) =>
                          arr.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  taskId: e.target.value
                                    ? (e.target.value as Id<"tasks">)
                                    : undefined,
                                }
                              : x,
                          ),
                        )
                      }
                      className="input flex-1 text-xs"
                    >
                      <option value="">Sin tarea enlazada (se marca a mano)</option>
                      {openTasks.map((t) => (
                        <option key={t._id} value={t._id}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                    {d.carryCount > 0 && (
                      <span className="shrink-0 rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger">
                        arrastrado ×{d.carryCount}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="label mb-2">Notas de la semana (opcional)</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Contexto, decisiones, lo que se acordó…"
              className="input w-full resize-y text-sm"
            />
          </div>
          <p className="text-[11px] text-faint">
            Al cerrar se congela el resumen con su frase y se limpian los pines 📌.
          </p>
        </div>

        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          {data.closed && (
            <button
              onClick={() => {
                if (!token) return;
                void reopen({
                  sessionToken: token,
                  id: data.closed!.id as Id<"catchups">,
                }).then(() => {
                  toast.success("Catch-up reabierto");
                  onClose();
                });
              }}
              className="btn-ghost gap-1.5 text-xs text-danger"
            >
              <Unlock className="h-3.5 w-3.5" />
              Reabrir semana
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onClose} className="btn btn-secondary text-xs">
              Cancelar
            </button>
            <button
              onClick={() => void submit()}
              disabled={saving}
              className="btn btn-primary gap-1.5 text-xs"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Lock className="h-3.5 w-3.5" />
              )}
              {data.closed ? "Guardar cierre" : "Cerrar catch-up"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
//  HISTORIAL (lista simple de semanas cerradas)
// ============================================================

function HistoryDrawer({
  currentFrom,
  onJump,
  onClose,
}: {
  /** weekStart de la semana en curso, para calcular el offset de salto. */
  currentFrom: number;
  onJump: (weekStart: number) => void;
  onClose: () => void;
}) {
  const { token } = useAuth();
  const history = useQuery(
    api.catchups.history,
    token ? { sessionToken: token } : "skip",
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50"
      onClick={onClose}
    >
      <motion.div
        initial={{ x: 320 }}
        animate={{ x: 0 }}
        exit={{ x: 320 }}
        transition={{ type: "spring", stiffness: 340, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        className="absolute right-0 top-0 flex h-full w-full max-w-sm flex-col border-l border-line bg-canvas shadow-el-lg"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="font-display text-sm font-bold text-ink">Semanas cerradas</h3>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {!history ? (
            <div className="grid place-items-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
            </div>
          ) : history.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-mute">
              Todavía no cerraste ningún catch-up.
            </p>
          ) : (
            <div className="space-y-1.5">
              {history.map((h) => {
                const label = formatWindowLabel(h.weekStart, h.weekEnd);
                const isCurrent = h.weekStart === currentFrom;
                return (
                  <button
                    key={h.id}
                    onClick={() => onJump(h.weekStart)}
                    className={cn(
                      "w-full rounded-el border-el px-3 py-2.5 text-left transition-colors",
                      isCurrent
                        ? "border-accent/50 bg-accent/5"
                        : "border-line bg-panel hover:bg-panel2",
                    )}
                  >
                    <p className="text-sm font-semibold capitalize text-ink">{label}</p>
                    {h.headline ? (
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-mute">
                        {h.headline}
                      </p>
                    ) : (
                      h.metrics && (
                        <p className="mt-0.5 text-[11px] text-faint">
                          {h.metrics.completed ?? 0} completadas · {h.commitmentCount} compromisos
                        </p>
                      )
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
//  DÍA DEL CATCH-UP
// ============================================================

function AnchorDayPicker({
  current,
  onDone,
}: {
  current: number;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const setAnchorDay = useMutation(api.catchups.setAnchorDay);
  const [saving, setSaving] = useState<number | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-el border-el border-line bg-panel px-3 py-2.5">
        <span className="text-xs font-semibold text-mute">El catch-up arranca el</span>
        {DAY_LABELS.map((label, day) => (
          <button
            key={day}
            disabled={saving !== null}
            onClick={() => {
              if (!token || day === current) {
                onDone();
                return;
              }
              setSaving(day);
              void setAnchorDay({ sessionToken: token, day }).then(onDone);
            }}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
              day === current
                ? "bg-accent text-acfg"
                : "text-mute hover:bg-panel2 hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
        <button onClick={onDone} className="ml-auto btn-ghost p-1 text-faint">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  );
}
