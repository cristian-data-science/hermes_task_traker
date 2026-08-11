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
import type { FunctionReturnType } from "convex/server";
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
  Archive,
  RefreshCw,
  Link2,
  CalendarRange,
  ListChecks,
  BarChart3,
  Square,
  CheckSquare,
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
import {
  buildCatchupText,
  queuedOf,
  pendingOf,
  type WeekData,
  type WeekBody,
} from "../lib/catchupSummary";
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
  /**
   * Identidad estable a través de los arrastres. Se propaga al arrastrar para
   * que la bitácora pueda reconstruir el linaje aunque reformules el texto.
   */
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

  /**
   * Semana cerrada CON snapshot: se puede mostrar lo que se presentó ese día.
   *
   * Por defecto se muestra el congelado, no el estado de hoy. Un catch-up
   * cerrado es un documento, no un tablero en vivo: si al abrirlo mostrara el
   * presente, la pantalla estaría afirmando cosas falsas sobre el pasado sin
   * ninguna señal de que lo hace.
   */
  const frozen = !!data?.closed?.snapshot;
  const [showFrozen, setShowFrozen] = useState(true);

  const windowLabel = formatWindowLabel(from, to);
  const isCurrent = offset === 0;

  if (!data) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  // Alias ya estrechado: TypeScript pierde el narrowing de `data` dentro de
  // los closures de abajo, y `data!` en cada uso ensucia más de lo que aclara.
  const week = data;

  /** Lo que se dibuja: el snapshot congelado o el cálculo en vivo. */
  const body: WeekBody =
    frozen && showFrozen ? week.closed!.snapshot! : (week as WeekBody);

  function copySummary() {
    // El texto copiado sigue al toggle: si estás mirando lo que presentaste,
    // eso es lo que se copia. Copiar una cosa distinta de la que se ve sería
    // una trampa silenciosa.
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

      {/* Aviso + toggle cuando la semana está cerrada y hay snapshot */}
      {frozen && (
        <FrozenBanner
          mode={showFrozen ? "frozen" : "today"}
          closedAt={data.closed!.closedAt}
          onToggle={() => setShowFrozen((v) => !v)}
        />
      )}

      {/* ===== 2 a 7: el cuerpo del resumen ===== */}
      <CatchupBody body={body} tasks={tasks} onEditTask={onEditTask} />

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

/**
 * El cuerpo del resumen de una semana.
 *
 * Se extrae en su propio componente para que la semana en vivo, una semana
 * cerrada y un catch-up abierto desde la bitácora se dibujen con el MISMO
 * código. Si fueran tres renders distintos, con el tiempo se desincronizarían
 * y la versión histórica —la que menos se mira— sería la que quedaría rota.
 */
function CatchupBody({
  body,
  tasks,
  onEditTask,
}: {
  body: WeekBody;
  tasks: Doc<"tasks">[];
  onEditTask: (t: Doc<"tasks">) => void;
}) {
  return (
    <>
      <MetricsRow metrics={body.metrics} />
      <DoneBlock done={body.done} tasks={tasks} onEditTask={onEditTask} />
      <AdvancedBlock
        // Cualquier tarea abierta puede haber avanzado en sub-tareas sin
        // cerrarse. Si solo se mirara `inProgress`, ese avance se perdería del
        // resumen y la semana se vería más vacía de lo que fue.
        inProgress={[...body.inProgress, ...queuedOf(body), ...pendingOf(body)]}
        tasks={tasks}
        onEditTask={onEditTask}
      />
      <OpenBlock
        title="En curso"
        subtitle="Lo que estás trabajando y hace cuánto"
        items={body.inProgress}
        empty="No hay nada en curso."
        tasks={tasks}
        onEditTask={onEditTask}
      />
      <OpenBlock
        title="En cola"
        subtitle="Urgentes esperando que las tomes"
        items={queuedOf(body)}
        empty="Nada urgente en espera."
        warnAfterDays={7}
        tasks={tasks}
        onEditTask={onEditTask}
      />
      <OpenBlock
        title="Pendientes"
        subtitle="Backlog vivo, sin urgencia declarada"
        items={pendingOf(body)}
        empty="Sin pendientes."
        warnAfterDays={30}
        tasks={tasks}
        onEditTask={onEditTask}
      />
      <OpenBlock
        title="Detenido / esperando"
        subtitle="Standby y programado — lo que se conversa en el catch-up"
        items={body.blocked}
        empty="Nada detenido."
        warnAfterDays={14}
        tasks={tasks}
        onEditTask={onEditTask}
      />
      <ReopenedBlock moves={body.moves} tasks={tasks} onEditTask={onEditTask} />
      <IncomingBlock incoming={body.incoming} tasks={tasks} onEditTask={onEditTask} />
      <TalkingPointsBlock points={body.talkingPoints} tasks={tasks} onEditTask={onEditTask} />
    </>
  );
}

/**
 * Sello de "esto es historia" con el toggle para comparar contra el presente.
 *
 * El sello no es decorativo: sin él, una semana cerrada y la semana en curso
 * se ven idénticas, y no habría forma de saber si los números que estás
 * leyendo son de entonces o de ahora.
 */
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
            <span className="font-semibold">Así lo presentaste</span> — congelado
            al cerrar, el{" "}
            {format(new Date(closedAt), "d 'de' MMMM 'a las' HH:mm", { locale: es })}.
          </>
        ) : (
          <>
            <span className="font-semibold">Estado de hoy</span> — estos bloques
            reflejan el tablero actual, no cómo estaba esa semana.
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
  const { token } = useAuth();
  const setDone = useMutation(api.catchups.setCommitmentDone);
  const done = previous.commitments.filter((c) => c.outcome === "done").length;

  return (
    <Section
      title="Venís de"
      subtitle={`${done}/${previous.commitments.length} compromisos cumplidos`}
    >
      <div className="overflow-hidden rounded-el border-el border-line bg-panel shadow-el">
        {previous.commitments.map((c) => {
          const task = c.taskId ? tasks.find((t) => t._id === c.taskId) : undefined;
          // Sin tarea enlazada la app no puede saber si lo cumpliste: el
          // check es la única fuente de verdad y por eso es clickeable.
          // Con tarea enlazada NO lo es — se cumple completando la tarea, y
          // permitir marcarlo a mano sería poder maquillar la métrica.
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
                      toast.error(
                        err instanceof Error ? err.message : "No se pudo marcar",
                      ),
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
      label: "En curso",
      value: metrics.inProgress,
      foot: <span className="text-faint">trabajándose ahora</span>,
    },
    {
      // Urgente ya no suma a "En curso": una tarea urgente es una que hay que
      // empezar, no una que se esté haciendo. Mezclarlas inflaba el número.
      label: "En cola",
      value: metrics.queued ?? 0,
      foot: <span className="text-faint">urgentes por tomar</span>,
    },
    {
      label: "Pendientes",
      value: metrics.pending ?? 0,
      foot: <span className="text-faint">backlog vivo</span>,
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
    <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
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
        rootId: c.rootId,
      }));
    }
    // Arranque nuevo: se arrastra lo que quedó pendiente la semana pasada.
    // "gone" (la tarea ya no existe) no se arrastra: no tendría contra qué
    // resolverse y quedaría eternamente sin desenlace.
    const carried = (data.previous?.commitments ?? [])
      .filter((c) => c.outcome !== "done" && c.outcome !== "gone")
      .map((c) => ({
        id: `${c.id}-carry`,
        text: c.text,
        taskId: (c.taskId as Id<"tasks"> | null) ?? undefined,
        carryCount: c.carryCount + 1,
        // El rootId NO cambia: es lo que une esta aparición con la original.
        rootId: c.rootId,
      }));
    return carried;
  });

  function addDraft() {
    setDrafts((d) => {
      const id = `new-${Date.now()}-${d.length}`;
      // Un compromiso nuevo es la raíz de su propia cadena.
      return [...d, { id, rootId: id, text: "", carryCount: 0 }];
    });
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

type HistoryTab = "weeks" | "chain" | "trend";

/**
 * Bitácora: el panel que convierte los catch-ups cerrados en algo consultable.
 *
 * Tres pestañas, tres preguntas distintas:
 *  - **Semanas**: "¿qué presenté el 4 de agosto?" → abre el snapshot real.
 *  - **Compromisos**: "¿qué vengo prometiendo hace rato?" → el linaje.
 *  - **Tendencia**: "¿estoy mejorando?" → volumen y cumplimiento en el tiempo.
 */
function HistoryDrawer({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<HistoryTab>("weeks");
  const [openId, setOpenId] = useState<Id<"catchups"> | null>(null);

  const TABS: { id: HistoryTab; label: string; Icon: typeof CalendarRange }[] = [
    { id: "weeks", label: "Semanas", Icon: CalendarRange },
    { id: "chain", label: "Compromisos", Icon: ListChecks },
    { id: "trend", label: "Tendencia", Icon: BarChart3 },
  ];

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
        className="flex h-full w-full max-w-md flex-col border-l border-line bg-canvas shadow-el-lg"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <History className="h-4 w-4 text-accent" />
          <h3 className="flex-1 font-display text-sm font-bold text-ink">Bitácora</h3>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-0.5 border-b border-line px-2 py-1.5">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-el px-2 py-1.5 text-xs font-medium transition-colors",
                tab === id
                  ? "bg-accent text-acfg"
                  : "text-mute hover:bg-panel2 hover:text-ink",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {tab === "weeks" && <WeeksTab onOpen={setOpenId} />}
          {tab === "chain" && <ChainTab />}
          {tab === "trend" && <TrendTab />}
        </div>
      </motion.aside>

      <AnimatePresence>
        {openId && (
          <ClosedCatchupPanel id={openId} onClose={() => setOpenId(null)} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** Pestaña "Semanas": lista de cierres, cada uno abrible. */
function WeeksTab({ onOpen }: { onOpen: (id: Id<"catchups">) => void }) {
  const { token } = useAuth();
  const rows = useQuery(
    api.catchups.history,
    token ? { sessionToken: token } : "skip",
  );

  if (rows === undefined) return <DrawerLoader />;
  if (rows.length === 0)
    return <EmptyRow text="Todavía no cerraste ningún catch-up." />;

  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <button
          key={r.id}
          onClick={() => onOpen(r.id as Id<"catchups">)}
          className="w-full rounded-el border-el border-line bg-panel p-3 text-left shadow-el transition-colors hover:border-accent/50 hover:bg-panel2"
        >
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-sm font-semibold text-ink">
              {formatWindowLabel(r.weekStart, r.weekEnd)}
            </p>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
          </div>
          <p className="text-[11px] text-faint">
            Cerrado el{" "}
            {format(new Date(r.closedAt), "d 'de' MMMM, HH:mm", { locale: es })}
          </p>
          {r.metrics && (
            <p className="mt-1 text-xs text-mute">
              {r.metrics.completed} completadas · {r.commitmentCount} compromisos
            </p>
          )}
          {r.notes && (
            <p className="mt-1 line-clamp-2 text-[11px] italic text-faint">
              {r.notes}
            </p>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * Pestaña "Compromisos": el linaje de cada promesa a través de las semanas.
 *
 * Los abandonados van arriba de los cumplidos aunque sean menos: un compromiso
 * que se dejó de mencionar es información que no aparece en ningún otro lado.
 */
function ChainTab() {
  const { token } = useAuth();
  const chains = useQuery(
    api.catchups.chain,
    token ? { sessionToken: token } : "skip",
  );

  if (chains === undefined) return <DrawerLoader />;
  if (chains.length === 0)
    return <EmptyRow text="Sin compromisos registrados todavía." />;

  const RANK: Record<string, number> = { dropped: 0, open: 1, done: 2 };
  const sorted = [...chains].sort(
    (a, b) => RANK[a.outcome] - RANK[b.outcome] || b.weeks - a.weeks,
  );

  const META: Record<
    string,
    { label: string; tone: string; Icon: typeof Check }
  > = {
    done: { label: "Cumplido", tone: "text-emerald-500", Icon: Check },
    open: { label: "Abierto", tone: "text-amber-500", Icon: CircleDashed },
    dropped: { label: "Abandonado", tone: "text-danger", Icon: AlertTriangle },
  };

  return (
    <div className="space-y-2">
      {sorted.map((c) => {
        const meta = META[c.outcome];
        return (
          <div
            key={c.rootId}
            className="rounded-el border-el border-line bg-panel p-3 shadow-el"
          >
            <div className="flex items-start gap-2">
              <meta.Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.tone)} />
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
              {c.taskId && (
                <Link2 className="mt-0.5 h-3 w-3 shrink-0 text-faint" />
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold",
                  c.weeks > 1
                    ? "bg-danger/10 text-danger"
                    : "bg-panel2 text-mute",
                )}
              >
                {c.weeks === 1
                  ? "1 semana"
                  : `prometido ${c.weeks} semanas seguidas`}
              </span>
              <span className="text-[10px] text-faint">
                {format(new Date(c.firstWeek), "d MMM", { locale: es })}
                {c.weeks > 1 &&
                  ` → ${format(new Date(c.lastWeek), "d MMM", { locale: es })}`}
              </span>
              <span className={cn("ml-auto text-[10px] font-semibold", meta.tone)}>
                {meta.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Pestaña "Tendencia": volumen entregado y cumplimiento en el tiempo. */
function TrendTab() {
  const { token } = useAuth();
  const series = useQuery(
    api.catchups.trend,
    token ? { sessionToken: token, weeks: 12 } : "skip",
  );

  if (series === undefined) return <DrawerLoader />;
  if (series.length === 0)
    return <EmptyRow text="Cerrá al menos un catch-up para ver la tendencia." />;

  return (
    <div className="space-y-3">
      <TrendChart series={series} />
      <div className="rounded-el border-el border-line bg-panel p-3 text-[11px] text-faint">
        <p className="mb-1 font-semibold text-mute">Cómo leer esto</p>
        <p>
          Las barras son lo entregado (tareas completadas). La línea es el
          porcentaje de compromisos que cumpliste esa semana, medido por lo que
          decidiste en el catch-up siguiente: si un compromiso volvió arrastrado,
          cuenta como no cumplido.
        </p>
        <p className="mt-1">
          La última semana aparece sin línea porque todavía no hay un catch-up
          posterior que la evalúe.
        </p>
      </div>
    </div>
  );
}

/**
 * Gráfico combinado, en SVG a mano.
 *
 * Sin librería de charts a propósito: es una serie de 12 puntos y traer una
 * dependencia nueva al bundle por esto sería desproporcionado.
 */
function TrendChart({
  series,
}: {
  series: NonNullable<FunctionReturnType<typeof api.catchups.trend>>;
}) {
  const W = 320;
  const H = 150;
  const PAD = { top: 12, right: 8, bottom: 22, left: 22 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  // La escala arranca en 1 aunque no haya nada, para no dividir por cero ni
  // dibujar barras de altura infinita en una semana vacía.
  const maxVol = Math.max(1, ...series.map((s) => s.completed));
  const bandW = innerW / series.length;
  const barW = Math.max(4, bandW * 0.55);

  const x = (i: number) => PAD.left + bandW * i + bandW / 2;
  const yVol = (v: number) => PAD.top + innerH - (v / maxVol) * innerH;
  const yRate = (r: number) => PAD.top + innerH - r * innerH;

  // La línea solo une puntos con rate conocido; los null cortan el trazo en
  // vez de interpolarse, que sería inventar un dato.
  const pts = series
    .map((s, i) => (s.rate === null ? null : { x: x(i), y: yRate(s.rate) }))
    .filter((p): p is { x: number; y: number } => p !== null);
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  return (
    <div className="rounded-el border-el border-line bg-panel p-2 shadow-el">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {/* Guías de 0 / 50 / 100% */}
        {[0, 0.5, 1].map((r) => (
          <g key={r}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={yRate(r)}
              y2={yRate(r)}
              stroke="var(--border)"
              strokeDasharray="2 3"
            />
            <text
              x={PAD.left - 4}
              y={yRate(r) + 3}
              textAnchor="end"
              fontSize="7"
              fill="var(--faint)"
            >
              {r * 100}%
            </text>
          </g>
        ))}

        {/* Barras de volumen */}
        {series.map((s, i) => {
          const h = innerH - (yVol(s.completed) - PAD.top);
          return (
            <rect
              key={s.weekStart}
              x={x(i) - barW / 2}
              y={yVol(s.completed)}
              width={barW}
              height={Math.max(0, h)}
              rx="2"
              fill="var(--accent)"
              opacity="0.28"
            >
              <title>
                {`${format(new Date(s.weekStart), "d MMM", { locale: es })}: ${s.completed} completadas`}
              </title>
            </rect>
          );
        })}

        {/* Línea de cumplimiento */}
        {pts.length > 1 && (
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
        )}
        {series.map((s, i) =>
          s.rate === null ? (
            // Semana sin evaluar: círculo hueco, para que se distinga de un 0%.
            <circle
              key={s.weekStart}
              cx={x(i)}
              cy={yRate(0)}
              r="2.5"
              fill="none"
              stroke="var(--faint)"
              strokeDasharray="1 1"
            >
              <title>Todavía sin evaluar</title>
            </circle>
          ) : (
            <circle
              key={s.weekStart}
              cx={x(i)}
              cy={yRate(s.rate)}
              r="2.5"
              fill="var(--accent)"
            >
              <title>
                {`${Math.round(s.rate * 100)}% (${s.commitmentsDone}/${s.commitmentsTotal})`}
              </title>
            </circle>
          ),
        )}

        {/* Etiquetas del eje X: una de cada dos, para que no se pisen */}
        {series.map((s, i) =>
          i % 2 === 0 || series.length <= 6 ? (
            <text
              key={s.weekStart}
              x={x(i)}
              y={H - 6}
              textAnchor="middle"
              fontSize="7"
              fill="var(--faint)"
            >
              {format(new Date(s.weekStart), "d/M")}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

/**
 * Un catch-up cerrado, abierto en solo lectura.
 *
 * Muestra el snapshot congelado —lo que efectivamente presentaste— y no el
 * estado actual del tablero. Los compromisos sí se resuelven contra el
 * presente, porque ahí la pregunta que interesa es "¿en qué terminó lo que
 * prometí ese día?".
 */
function ClosedCatchupPanel({
  id,
  onClose,
}: {
  id: Id<"catchups">;
  onClose: () => void;
}) {
  const { token } = useAuth();
  const row = useQuery(
    api.catchups.getClosed,
    token ? { sessionToken: token, id } : "skip",
  );
  const tasks =
    useQuery(api.tasks.list, token ? { sessionToken: token } : "skip") ?? [];

  function copy() {
    if (!row?.snapshot) return;
    const text = buildCatchupText(
      {
        ...(row.snapshot as WeekBody),
        previous: null,
        closed: null,
        anchorDay: 2,
      } as unknown as WeekData,
      {
        windowLabel: formatWindowLabel(row.weekStart, row.weekEnd),
        notes: row.notes ?? undefined,
      },
    );
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success("Resumen copiado"))
      .catch(() => toast.error("No se pudo copiar"));
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.97, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.97, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-el-lg border-el border-line bg-canvas shadow-el-lg"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Archive className="h-4 w-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-display text-sm font-bold text-ink">
              {row ? formatWindowLabel(row.weekStart, row.weekEnd) : "Cargando…"}
            </h3>
            {row && (
              <p className="text-[11px] text-faint">
                Presentado el{" "}
                {format(new Date(row.closedAt), "d 'de' MMMM 'a las' HH:mm", {
                  locale: es,
                })}{" "}
                · solo lectura
              </p>
            )}
          </div>
          <button onClick={copy} className="btn btn-secondary gap-1.5 text-xs">
            <Copy className="h-3.5 w-3.5" />
            Copiar
          </button>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {row === undefined ? (
            <DrawerLoader />
          ) : row === null ? (
            <EmptyRow text="Este catch-up ya no existe." />
          ) : (
            <>
              {row.commitments.length > 0 && (
                <Section
                  title="Compromisos asumidos ese día"
                  subtitle="Resueltos contra el tablero de hoy"
                >
                  <div className="overflow-hidden rounded-el border-el border-line bg-panel shadow-el">
                    {row.commitments.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-start gap-2.5 border-b border-line px-3 py-2.5 last:border-0"
                      >
                        <span className="mt-0.5 shrink-0">
                          {c.outcome === "done" ? (
                            <Check className="h-4 w-4 text-emerald-500" />
                          ) : c.outcome === "progress" ? (
                            <CircleDashed className="h-4 w-4 text-amber-500" />
                          ) : c.outcome === "gone" ? (
                            <Trash2 className="h-4 w-4 text-faint" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-danger" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-ink">{c.text}</p>
                          <p className="text-[11px] text-faint">{c.reason}</p>
                        </div>
                        {c.carryCount > 0 && (
                          <span className="shrink-0 rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger">
                            ×{c.carryCount}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {row.notes && (
                <Section title="Notas">
                  <div className="whitespace-pre-wrap rounded-el border-el border-line bg-panel p-3 text-sm text-mute shadow-el">
                    {row.notes}
                  </div>
                </Section>
              )}

              {row.snapshot ? (
                <CatchupBody
                  body={row.snapshot as WeekBody}
                  tasks={tasks}
                  onEditTask={() => {
                    // Solo lectura a propósito: editar desde un documento
                    // histórico invitaría a confundir el pasado con el presente.
                  }}
                />
              ) : (
                <EmptyRow text="El resumen congelado de esta semana no se pudo leer." />
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Spinner compartido por las pestañas de la bitácora. */
function DrawerLoader() {
  return (
    <div className="grid place-items-center py-8">
      <Loader2 className="h-5 w-5 animate-spin text-accent" />
    </div>
  );
}
