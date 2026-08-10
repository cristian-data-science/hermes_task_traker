/**
 * Vista Catch-up: la semana resumida para la reunión con la jefatura.
 *
 * ===== EL PRINCIPIO DE DISEÑO =====
 * Acá no se llena nada a mano. Todo lo que se ve sale de haber usado el
 * tablero durante la semana. Lo único que se escribe son los COMPROMISOS al
 * cerrar, porque eso es una decisión, no un dato.
 *
 * El orden de los bloques imita el orden en que una jefatura pregunta:
 *   1. ¿Qué habías dicho que ibas a hacer?   → "Venís de…"
 *   2. ¿Cómo te fue?                          → métricas + completado
 *   3. ¿En qué estás?                         → en curso
 *   4. ¿Qué está trabado y por qué?           → detenido
 *   5. ¿Por qué no avanzó lo otro?            → entró esta semana
 *   6. ¿Algo más?                             → temas para conversar
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  CircleDashed,
  AlertTriangle,
  Trash2,
  Copy,
  Lock,
  Unlock,
  History,
  X,
  Plus,
  Pin,
  ExternalLink,
  Settings2,
  TrendingUp,
  TrendingDown,
  Minus,
  Inbox,
  Loader2,
} from "lucide-react";
import toast from "react-hot-toast";
import { api } from "~/convex/_generated/api";
import type { Doc, Id } from "~/convex/_generated/dataModel";
import {
  startOfCurrentWeek,
  weekWindow,
  shiftWeek,
  formatWindowLabel,
  DAY_LABELS,
} from "~/convex/catchupConfig";
import { useAuth } from "../hooks/useAuth";
import { STATUS_META, type Status } from "../lib/constants";
import { buildCatchupText, type WeekData } from "../lib/catchupSummary";
import { cn } from "../lib/utils";

interface CatchupViewProps {
  /** Tareas vivas, para poder abrir el modal de edición desde el resumen. */
  tasks: Doc<"tasks">[];
  onEditTask: (task: Doc<"tasks">) => void;
}

/** Borrador de compromiso mientras se edita en el modal de cierre. */
interface CommitmentDraft {
  id: string;
  text: string;
  taskId?: Id<"tasks">;
  carryCount: number;
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [daySettingOpen, setDaySettingOpen] = useState(false);

  // La ventana se calcula en el CLIENTE, en hora local, y se manda al backend
  // ya resuelta. Ver el comentario grande en `convex/catchupConfig.ts`.
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

  const windowLabel = formatWindowLabel(from, to);
  const isCurrent = offset === 0;

  if (!data) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  function copySummary() {
    const text = buildCatchupText(data as WeekData, { windowLabel });
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success("Resumen copiado"))
      .catch(() => toast.error("No se pudo copiar al portapapeles"));
  }

  return (
    <div className="mx-auto max-w-[1100px] pb-16">
      {/* ===== Cabecera: navegación de semana ===== */}
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
            {isCurrent ? "Semana en curso" : "Semana cerrada"}
            {data.closed && ` · cerrado el ${format(new Date(data.closed.closedAt), "d 'de' MMMM", { locale: es })}`}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={copySummary} className="btn btn-secondary gap-1.5 text-xs">
            <Copy className="h-3.5 w-3.5" />
            Copiar resumen
          </button>
          <button
            onClick={() => setHistoryOpen(true)}
            className="btn-ghost p-2"
            title="Bitácora de catch-ups"
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
            {data.closed ? "Editar cierre" : "Cerrar catch-up"}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {daySettingOpen && <AnchorDayPicker current={anchorDay ?? 2} onDone={() => setDaySettingOpen(false)} />}
      </AnimatePresence>

      {/* ===== 1. Venís de… ===== */}
      {data.previous && data.previous.commitments.length > 0 && (
        <PreviousBlock previous={data.previous} tasks={tasks} onEditTask={onEditTask} />
      )}

      {/* ===== 2. Métricas ===== */}
      <MetricsRow metrics={data.metrics} />

      {/* ===== 3. Completado ===== */}
      <DoneBlock done={data.done} tasks={tasks} onEditTask={onEditTask} />

      {/* ===== 3b. Avances sin cierre ===== */}
      <AdvancedBlock inProgress={data.inProgress} tasks={tasks} onEditTask={onEditTask} />

      {/* ===== 4. En curso ===== */}
      <OpenBlock
        title="En curso ahora"
        subtitle="Lo que está abierto y su antigüedad en el estado actual"
        items={data.inProgress}
        empty="No hay nada en curso ni urgente."
        tasks={tasks}
        onEditTask={onEditTask}
      />

      {/* ===== 5. Detenido ===== */}
      <OpenBlock
        title="Detenido / esperando"
        subtitle="Standby y programado — lo que se conversa en el catch-up"
        items={data.blocked}
        empty="Nada detenido."
        warnAfterDays={14}
        tasks={tasks}
        onEditTask={onEditTask}
      />

      {/* ===== 5b. Reabierto ===== */}
      <ReopenedBlock moves={data.moves} tasks={tasks} onEditTask={onEditTask} />

      {/* ===== 6. Entró esta semana ===== */}
      <IncomingBlock incoming={data.incoming} tasks={tasks} onEditTask={onEditTask} />

      {/* ===== 7. Temas para conversar ===== */}
      <TalkingPointsBlock points={data.talkingPoints} tasks={tasks} onEditTask={onEditTask} />

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
        {historyOpen && <HistoryDrawer onClose={() => setHistoryOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
//  BLOQUES
// ============================================================

/** Contenedor común de cada sección, para que todas respiren igual. */
function Section({
  title,
  subtitle,
  count,
  children,
}: {
  title: string;
  subtitle?: string;
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
          <span className="rounded-full bg-panel2 px-2 py-0.5 text-[11px] font-semibold text-mute">
            {count}
          </span>
        )}
        {subtitle && <span className="text-xs text-faint">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

/** Fila vacía con un mensaje, para que un bloque sin datos no se vea roto. */
function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-el border-el border-dashed border-line bg-panel/40 px-3 py-4 text-center text-xs text-faint">
      {text}
    </div>
  );
}

/** Ruta ClickUp comprimida: primer y último segmento. */
function PlaceLabel({ project, ancestors }: { project: string | null; ancestors: string[] }) {
  const parts = [project, ...ancestors].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  const txt =
    parts.length <= 2 ? parts.join(" › ") : `${parts[0]} › … › ${parts[parts.length - 1]}`;
  return <span className="truncate text-[11px] text-faint">{txt}</span>;
}

/** Chip de estado reutilizando la metadata visual del resto de la app. */
function StatusChip({ status }: { status: string }) {
  const meta = STATUS_META[status as Status];
  if (!meta) return null;
  const { Icon, label, tone } = meta;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ color: tone, backgroundColor: `color-mix(in srgb, ${tone} 14%, transparent)` }}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

/** Días transcurridos desde `since`, en lenguaje corto. */
function ageLabel(since: number | null): string {
  if (since === null) return "";
  const d = Math.floor((Date.now() - since) / DAY_MS);
  if (d <= 0) return "hoy";
  if (d === 1) return "1 día";
  return `${d} días`;
}

/**
 * Qué significa el número de antigüedad. Se distingue en la UI porque una
 * tarea sin bitácora solo puede reportar su edad total, no su tiempo en el
 * estado actual, y presentar una cosa como la otra sería mentir en el número
 * que más se mira.
 */
function ageTitle(kind: "status" | "created"): string {
  return kind === "status"
    ? "Tiempo en el estado actual"
    : "Antigüedad de la tarea (sin registro de cuándo entró a este estado)";
}

/**
 * Bloque "Venís de…": los compromisos de la semana pasada, ya resueltos.
 * Es lo primero que se ve a propósito — es lo primero que te van a preguntar.
 */
function PreviousBlock({
  previous,
  tasks,
  onEditTask,
}: {
  previous: NonNullable<WeekData["previous"]>;
  tasks: Doc<"tasks">[];
  onEditTask: (t: Doc<"tasks">) => void;
}) {
  const done = previous.commitments.filter((c) => c.outcome === "done").length;
  return (
    <Section
      title="Venís de"
      subtitle={`${done}/${previous.commitments.length} compromisos cumplidos`}
    >
      <div className="overflow-hidden rounded-el border-el border-line bg-panel shadow-el">
        {previous.commitments.map((c) => {
          const task = c.taskId ? tasks.find((t) => t._id === c.taskId) : undefined;
          const mark =
            c.outcome === "done" ? (
              <Check className="h-4 w-4 text-emerald-500" />
            ) : c.outcome === "progress" ? (
              <CircleDashed className="h-4 w-4 text-amber-500" />
            ) : c.outcome === "gone" ? (
              <Trash2 className="h-4 w-4 text-faint" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-danger" />
            );
          return (
            <div
              key={c.id}
              className={cn(
                "flex items-start gap-2.5 border-b border-line px-3 py-2.5 last:border-0",
                task && "cursor-pointer hover:bg-panel2",
              )}
              onClick={() => task && onEditTask(task)}
            >
              <span className="mt-0.5 shrink-0">{mark}</span>
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
                // El arrastre se muestra en rojo a propósito: es la señal que
                // tu jefatura va a notar antes que vos.
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

/** Fila de métricas del titular. */
function MetricsRow({ metrics }: { metrics: WeekData["metrics"] }) {
  const delta = metrics.completed - metrics.completedPrevWeek;
  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const deltaTone =
    delta > 0 ? "text-emerald-500" : delta < 0 ? "text-danger" : "text-faint";

  const cards = [
    {
      label: "Completadas",
      value: metrics.completed,
      foot: (
        <span className={cn("inline-flex items-center gap-1", deltaTone)}>
          <DeltaIcon className="h-3 w-3" />
          {delta === 0 ? "igual" : `${delta > 0 ? "+" : ""}${delta}`} vs. semana pasada
        </span>
      ),
    },
    {
      label: "Sub-tareas cerradas",
      value: metrics.subtasksClosed,
      foot: <span className="text-faint">avance granular</span>,
    },
    {
      label: "En curso",
      value: metrics.inProgress,
      foot: <span className="text-faint">abiertas ahora</span>,
    },
    {
      label: "Detenidas",
      value: metrics.blocked,
      foot: <span className="text-faint">standby / programado</span>,
    },
    {
      label: "Entraron",
      value: metrics.created,
      foot: (
        <span className="text-faint">
          {metrics.closedSameWeek} cerradas en la misma semana
        </span>
      ),
    },
  ];

  return (
    <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-el border-el border-line bg-panel p-3 shadow-el"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">
            {c.label}
          </p>
          <p className="font-display text-2xl font-bold text-ink">{c.value}</p>
          <p className="mt-0.5 text-[11px]">{c.foot}</p>
        </div>
      ))}
    </div>
  );
}

/** Bloque "Completado esta semana", agrupado por día. */
function DoneBlock({
  done,
  tasks,
  onEditTask,
}: {
  done: WeekData["done"];
  tasks: Doc<"tasks">[];
  onEditTask: (t: Doc<"tasks">) => void;
}) {
  // La agrupación por día se hace acá, en el cliente, y no en el backend:
  // "qué día fue" depende de la zona horaria del que mira.
  const byDay = useMemo(() => {
    const map = new Map<string, WeekData["done"]>();
    for (const d of done) {
      const key = format(new Date(d.at), "yyyy-MM-dd");
      const arr = map.get(key);
      if (arr) arr.push(d);
      else map.set(key, [d]);
    }
    return Array.from(map.entries());
  }, [done]);

  return (
    <Section
      title="Completado esta semana"
      count={done.length}
      subtitle="El bloque que le presentás a tu jefatura"
    >
      {done.length === 0 ? (
        <EmptyRow text="Nada cerrado en esta ventana. Si hubo avance, mirá el bloque de abajo." />
      ) : (
        <div className="space-y-3">
          {byDay.map(([key, items]) => (
            <div key={key}>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-accent">
                {format(new Date(items[0].at), "EEEE d 'de' MMMM", { locale: es })}
              </p>
              <div className="overflow-hidden rounded-el border-el border-line bg-panel shadow-el">
                {items.map((d) => {
                  const task = tasks.find((t) => t._id === d.taskId);
                  return (
                    <div
                      key={d.taskId}
                      className={cn(
                        "border-b border-line px-3 py-2.5 last:border-0",
                        task && "cursor-pointer hover:bg-panel2",
                      )}
                      onClick={() => task && onEditTask(task)}
                    >
                      <div className="flex items-start gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-ink">{d.title}</p>
                          <div className="flex flex-wrap items-center gap-x-2">
                            <PlaceLabel project={d.project} ancestors={d.ancestors} />
                            {d.requestedBy && (
                              <span className="text-[11px] text-faint">
                                pide: {d.requestedBy}
                              </span>
                            )}
                            {!d.stillExists && (
                              <span className="text-[11px] italic text-faint">
                                (tarea eliminada después)
                              </span>
                            )}
                          </div>
                          {d.subtasks.length > 0 && (
                            <ul className="mt-1 space-y-0.5">
                              {d.subtasks.map((s, i) => (
                                <li
                                  key={i}
                                  className="flex items-center gap-1.5 text-[11px] text-mute"
                                >
                                  <Check className="h-3 w-3 shrink-0 text-emerald-500/70" />
                                  {s.title}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        {d.clickupUrl && (
                          <a
                            href={d.clickupUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0 text-faint hover:text-accent"
                            title="Abrir en ClickUp"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/**
 * Avances en tareas que NO se cerraron.
 *
 * Existe porque una semana dedicada entera a una tarea grande se vería vacía
 * sin él, y esa lectura es falsa e injusta con el trabajo hecho.
 */
function AdvancedBlock({
  inProgress,
  tasks,
  onEditTask,
}: {
  inProgress: WeekData["inProgress"];
  tasks: Doc<"tasks">[];
  onEditTask: (t: Doc<"tasks">) => void;
}) {
  const advanced = inProgress.filter((t) => t.advancedSubtasks.length > 0);
  if (advanced.length === 0) return null;
  return (
    <Section
      title="Avanzó, pero no cerró"
      count={advanced.length}
      subtitle="Sub-tareas completadas en tareas todavía abiertas"
    >
      <div className="overflow-hidden rounded-el border-el border-line bg-panel shadow-el">
        {advanced.map((t) => {
          const task = tasks.find((x) => x._id === t.taskId);
          return (
            <div
              key={t.taskId}
              className={cn(
                "border-b border-line px-3 py-2.5 last:border-0",
                task && "cursor-pointer hover:bg-panel2",
              )}
              onClick={() => task && onEditTask(task)}
            >
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {t.title}
                </p>
                {t.progress !== null && (
                  <span className="shrink-0 text-[11px] font-semibold text-accent">
                    {t.progress}%
                  </span>
                )}
              </div>
              <ul className="mt-1 space-y-0.5">
                {t.advancedSubtasks.map((s, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-[11px] text-mute">
                    <Check className="h-3 w-3 shrink-0 text-emerald-500/70" />
                    {s.title}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** Bloque genérico de trabajo abierto (en curso / detenido). */
function OpenBlock({
  title,
  subtitle,
  items,
  empty,
  warnAfterDays,
  tasks,
  onEditTask,
}: {
  title: string;
  subtitle: string;
  items: WeekData["inProgress"];
  empty: string;
  warnAfterDays?: number;
  tasks: Doc<"tasks">[];
  onEditTask: (t: Doc<"tasks">) => void;
}) {
  return (
    <Section title={title} count={items.length} subtitle={subtitle}>
      {items.length === 0 ? (
        <EmptyRow text={empty} />
      ) : (
        <div className="overflow-hidden rounded-el border-el border-line bg-panel shadow-el">
          {items.map((t) => {
            const task = tasks.find((x) => x._id === t.taskId);
            const days =
              t.since === null ? null : Math.floor((Date.now() - t.since) / DAY_MS);
            const stale =
              warnAfterDays !== undefined && days !== null && days >= warnAfterDays;
            return (
              <div
                key={t.taskId}
                className={cn(
                  "flex items-center gap-2 border-b border-line px-3 py-2.5 last:border-0",
                  task && "cursor-pointer hover:bg-panel2",
                )}
                onClick={() => task && onEditTask(task)}
              >
                <StatusChip status={t.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{t.title}</p>
                  <PlaceLabel project={t.project} ancestors={t.ancestors} />
                </div>
                {t.progress !== null && (
                  <span className="shrink-0 text-[11px] font-semibold text-accent">
                    {t.progress}%
                  </span>
                )}
                <span
                  className={cn(
                    "shrink-0 text-[11px]",
                    stale ? "font-bold text-danger" : "text-faint",
                    // Estimado (sin bitácora): se marca con puntos suspensivos
                    // bajo el texto en vez de esconderlo en un tooltip.
                    t.sinceKind === "created" && "italic decoration-dotted underline",
                  )}
                  title={ageTitle(t.sinceKind)}
                >
                  {t.sinceKind === "created" ? "~" : ""}
                  {ageLabel(t.since)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/**
 * Tareas que estaban completadas y volvieron a abrirse.
 *
 * Se muestra aparte y no mezclado en "en curso" porque es información de otro
 * tipo: algo que ya diste por cerrado en un catch-up anterior volvió. Es mejor
 * llevarlo vos a que lo descubra tu jefatura.
 *
 * Solo aparece si hay algo — un bloque vacío permanente enseña a ignorarlo.
 */
function ReopenedBlock({
  moves,
  tasks,
  onEditTask,
}: {
  moves: WeekData["moves"];
  tasks: Doc<"tasks">[];
  onEditTask: (t: Doc<"tasks">) => void;
}) {
  // Una tarea puede reabrirse dos veces en la semana: interesa la última.
  const reopened = useMemo(() => {
    const map = new Map<string, WeekData["moves"][number]>();
    for (const m of moves) if (m.reopened) map.set(m.taskId, m);
    return Array.from(map.values()).sort((a, b) => b.at - a.at);
  }, [moves]);

  if (reopened.length === 0) return null;

  return (
    <Section
      title="Reabierto esta semana"
      count={reopened.length}
      subtitle="Estaba cerrado y volvió"
    >
      <div className="overflow-hidden rounded-el border-el border-line bg-panel shadow-el">
        {reopened.map((m) => {
          const task = tasks.find((x) => x._id === m.taskId);
          return (
            <div
              key={m.taskId}
              className={cn(
                "flex items-center gap-2 border-b border-line px-3 py-2.5 last:border-0",
                task && "cursor-pointer hover:bg-panel2",
              )}
              onClick={() => task && onEditTask(task)}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              <p className="min-w-0 flex-1 truncate text-sm text-ink">{m.title}</p>
              <span className="shrink-0 text-[11px] text-faint">
                {format(new Date(m.at), "EEE d", { locale: es })}
              </span>
              {m.to && <StatusChip status={m.to} />}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** Lo que apareció durante la semana: la carga no planificada. */
function IncomingBlock({
  incoming,
  tasks,
  onEditTask,
}: {
  incoming: WeekData["incoming"];
  tasks: Doc<"tasks">[];
  onEditTask: (t: Doc<"tasks">) => void;
}) {
  return (
    <Section
      title="Entró esta semana"
      count={incoming.length}
      subtitle="Carga que no estaba planificada al último catch-up"
    >
      {incoming.length === 0 ? (
        <EmptyRow text="No entró nada nuevo." />
      ) : (
        <div className="overflow-hidden rounded-el border-el border-line bg-panel shadow-el">
          {incoming.map((t) => {
            const task = tasks.find((x) => x._id === t.taskId);
            return (
              <div
                key={t.taskId}
                className={cn(
                  "flex items-center gap-2 border-b border-line px-3 py-2.5 last:border-0",
                  task && "cursor-pointer hover:bg-panel2",
                )}
                onClick={() => task && onEditTask(task)}
              >
                <Inbox className="h-3.5 w-3.5 shrink-0 text-faint" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{t.title}</p>
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="text-[11px] text-faint">
                      {t.fromClickup ? "desde ClickUp" : "creada por vos"}
                    </span>
                    {t.requestedBy && (
                      <span className="text-[11px] text-faint">pide: {t.requestedBy}</span>
                    )}
                  </div>
                </div>
                {t.closedSameWeek && (
                  <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-500">
                    cerrada
                  </span>
                )}
                <StatusChip status={t.status} />
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/** Temas marcados a mano con el pin durante la semana. */
function TalkingPointsBlock({
  points,
  tasks,
  onEditTask,
}: {
  points: WeekData["talkingPoints"];
  tasks: Doc<"tasks">[];
  onEditTask: (t: Doc<"tasks">) => void;
}) {
  return (
    <Section
      title="Temas para conversar"
      count={points.length}
      subtitle="Marcados con el pin durante la semana"
    >
      {points.length === 0 ? (
        <EmptyRow text="Nada marcado. Usá el pin 📌 en una tarjeta cuando aparezca algo que quieras conversar." />
      ) : (
        <div className="overflow-hidden rounded-el border-el border-accent/40 bg-accent/5 shadow-el">
          {points.map((p) => {
            const task = tasks.find((x) => x._id === p.taskId);
            return (
              <div
                key={p.taskId}
                className={cn(
                  "flex items-start gap-2 border-b border-line/50 px-3 py-2.5 last:border-0",
                  task && "cursor-pointer hover:bg-panel2/50",
                )}
                onClick={() => task && onEditTask(task)}
              >
                <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{p.title}</p>
                  {p.note && <p className="text-xs text-mute">{p.note}</p>}
                </div>
                <StatusChip status={p.status} />
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ============================================================
//  CONFIGURACIÓN DEL DÍA ANCLA
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
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="mb-4 overflow-hidden"
    >
      <div className="rounded-el border-el border-line bg-panel p-3 shadow-el">
        <p className="label mb-2">¿Qué día tenés el catch-up?</p>
        <div className="flex flex-wrap gap-1.5">
          {DAY_LABELS.map((label, i) => (
            <button
              key={label}
              onClick={() => {
                if (!token) return;
                void setAnchorDay({ sessionToken: token, day: i }).then(() => {
                  toast.success(`Catch-up anclado al ${label.toLowerCase()}`);
                  onDone();
                });
              }}
              className={cn("chip", i === current && "chip-active")}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-faint">
          La ventana va de este día al mismo día de la semana siguiente.
        </p>
      </div>
    </motion.div>
  );
}

// ============================================================
//  MODAL DE CIERRE
// ============================================================

/**
 * Cierre de semana: congela el resumen y captura los compromisos.
 *
 * Los compromisos incumplidos de la semana anterior se pre-cargan con su
 * contador de arrastre incrementado. No se pueden "perder" silenciosamente:
 * hay que borrarlos a mano, que es una decisión consciente y distinta de
 * olvidarlos.
 */
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
    // Al reeditar un cierre existente, se reabre tal cual quedó.
    if (data.closed) {
      return data.closed.commitments.map((c) => ({
        id: c.id,
        text: c.text,
        taskId: (c.taskId as Id<"tasks"> | null) ?? undefined,
        carryCount: c.carryCount,
      }));
    }
    // Arranque nuevo: se arrastra lo que quedó pendiente la semana pasada.
    const carried = (data.previous?.commitments ?? [])
      .filter((c) => c.outcome !== "done" && c.outcome !== "gone")
      .map((c) => ({
        id: `${c.id}-carry`,
        text: c.text,
        taskId: (c.taskId as Id<"tasks"> | null) ?? undefined,
        carryCount: c.carryCount + 1,
      }));
    return carried;
  });

  function addDraft() {
    setDrafts((d) => [
      ...d,
      { id: `new-${Date.now()}-${d.length}`, text: "", carryCount: 0 },
    ]);
  }

  async function submit() {
    if (!token) return;
    setSaving(true);
    try {
      await close({
        sessionToken: token,
        from,
        to,
        notes: notes.trim() || undefined,
        commitments: drafts
          .filter((d) => d.text.trim())
          .map((d) => ({
            id: d.id,
            text: d.text.trim(),
            taskId: d.taskId,
            carryCount: d.carryCount,
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

  /** Candidatas a enlazar un compromiso: lo que está abierto ahora. */
  const openTasks = useMemo(
    () => tasks.filter((t) => t.status !== "completado" && t.area === "patagonia"),
    [tasks],
  );

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
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-el-lg border-el border-line bg-canvas shadow-el-lg"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Lock className="h-4 w-4 text-accent" />
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-sm font-bold text-ink">
              Cerrar catch-up · {windowLabel}
            </h3>
            <p className="text-[11px] text-faint">
              Se congela el resumen tal como está ahora y se guardan tus compromisos.
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* Compromisos */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="label">Compromisos para la próxima semana</p>
              <button onClick={addDraft} className="btn-ghost gap-1 text-xs">
                <Plus className="h-3.5 w-3.5" />
                Añadir
              </button>
            </div>
            {drafts.length === 0 && (
              <EmptyRow text="Sin compromisos. Añadí 3 a 5: es lo que la semana que viene se resuelve solo contra el tablero." />
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
                          arr.map((x, j) =>
                            j === i ? { ...x, text: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="Ej: dejar el alcance de Ley de Datos aprobado"
                      className="input flex-1 text-sm"
                    />
                    <button
                      onClick={() =>
                        setDrafts((arr) => arr.filter((_, j) => j !== i))
                      }
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
                      {/* Sin tarea enlazada el cumplimiento se marca a mano;
                          con tarea, la app lo resuelve sola. */}
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

          {/* Notas */}
          <div>
            <p className="label mb-2">Notas de la semana (opcional)</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Contexto, decisiones tomadas, lo que se acordó en la reunión…"
              className="input w-full resize-y text-sm"
            />
          </div>

          <p className="text-[11px] text-faint">
            Al cerrar se limpian los pines 📌 de la semana: ya los conversaste.
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
//  BITÁCORA
// ============================================================

/** Panel lateral con el historial de catch-ups cerrados. */
function HistoryDrawer({ onClose }: { onClose: () => void }) {
  const { token } = useAuth();
  const rows = useQuery(
    api.catchups.history,
    token ? { sessionToken: token } : "skip",
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
    >
      <motion.aside
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-sm flex-col border-l border-line bg-canvas shadow-el-lg"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <History className="h-4 w-4 text-accent" />
          <h3 className="flex-1 font-display text-sm font-bold text-ink">Bitácora</h3>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {rows === undefined ? (
            <div className="grid place-items-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyRow text="Todavía no cerraste ningún catch-up." />
          ) : (
            rows.map((r) => (
              <div
                key={r.id}
                className="rounded-el border-el border-line bg-panel p-3 shadow-el"
              >
                <p className="text-sm font-semibold text-ink">
                  {formatWindowLabel(r.weekStart, r.weekEnd)}
                </p>
                <p className="text-[11px] text-faint">
                  Cerrado el{" "}
                  {format(new Date(r.closedAt), "d 'de' MMMM, HH:mm", { locale: es })}
                </p>
                {r.metrics && (
                  <p className="mt-1 text-xs text-mute">
                    {r.metrics.completed} completadas · {r.metrics.subtasksClosed} sub-tareas ·{" "}
                    {r.commitmentCount} compromisos
                  </p>
                )}
                {r.notes && (
                  <p className="mt-1 line-clamp-3 text-[11px] italic text-faint">
                    {r.notes}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </motion.aside>
    </motion.div>
  );
}
