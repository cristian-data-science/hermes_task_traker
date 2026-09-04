import { useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useMutation, useQuery } from "convex/react";
import toast from "react-hot-toast";
import {
  ArrowUpRight,
  BarChart3,
  CalendarCheck,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ExternalLink,
  History,
  Plus,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { addDays, differenceInCalendarDays, format, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import type { Doc, Id } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import { useAuth } from "../hooks/useAuth";
import { cn } from "../lib/utils";
import { CompleteButton } from "./CompleteButton";
import { StatusDot } from "./Badges";
import { InsightsDrawer } from "./InsightsDrawer";

/** Id del droppable del panel (KanbanView lo intercepta en handleDragEnd). */
export const HOY_PANEL_DROP_ID = "hoy-panel";

/** Preferencia de colapso persistida (patrón useHiddenColumns). */
const STORAGE_KEY = "hoy-panel-collapsed";
function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Ancho del panel (redimensionable arrastrando el borde derecho).
 * MIN = el w-72 original; MAX deja lugar cómodo para las columnas del Kanban.
 */
const PANEL_MIN_W = 288;
const PANEL_MAX_W = 640;
const WIDTH_KEY = "hoy-panel-width";
function loadPanelWidth(): number | null {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(n) && n >= PANEL_MIN_W && n <= PANEL_MAX_W ? n : null;
  } catch {
    return null;
  }
}
function savePanelWidth(w: number | null) {
  try {
    if (w === null) localStorage.removeItem(WIDTH_KEY);
    else localStorage.setItem(WIDTH_KEY, String(w));
  } catch {
    /* ignore */
  }
}

interface HoyPanelProps {
  tasks: Doc<"tasks">[];
  onEditTask: (t: Doc<"tasks">) => void;
}

/**
 * Panel Hoy — la lista de prioridades del día, a la izquierda del Kanban.
 *
 * Tres secciones: Planeadas (punteros a tareas del tablero), Imprevistos
 * (alta rápida, no son tareas) y Abiertos de días anteriores (imprevistos
 * que quedaron dando vueltas, visibles hasta cerrarse).
 *
 * Drop: es un droppable del DndContext del Kanban — arrastrás una tarjeta de
 * cualquier columna y queda sumada al día SIN tocar su estado (el branch
 * vive en KanbanView.handleDragEnd).
 */
export function HoyPanel({ tasks, onEditTask }: HoyPanelProps) {
  const { token } = useAuth();
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [quickText, setQuickText] = useState("");
  const [showOld, setShowOld] = useState(true);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [width, setWidth] = useState<number | null>(loadPanelWidth);

  // El día lo calcula el cliente en hora local (patrón catch-up: el backend
  // solo compara números). Recalcular por render es barato y sobrevive la
  // medianoche sin recargar.
  const today = startOfDay(new Date()).getTime();
  const yesterday = startOfDay(addDays(new Date(), -1)).getTime();

  const dayItems =
    useQuery(api.hoy.listByDay, token ? { sessionToken: token, day: today } : "skip") ?? [];
  const imprevistos =
    useQuery(api.imprevistos.byDay, token ? { sessionToken: token, day: today } : "skip") ?? [];
  const abiertos =
    useQuery(api.imprevistos.openBefore, token ? { sessionToken: token, day: today } : "skip") ?? [];

  const addToHoy = useMutation(api.hoy.add);
  const removeFromHoy = useMutation(api.hoy.remove);
  const reorderHoy = useMutation(api.hoy.reorder);
  const carryOver = useMutation(api.hoy.carryOverFrom);
  const createImprevisto = useMutation(api.imprevistos.create);
  const resolveImprevisto = useMutation(api.imprevistos.resolve);
  const reopenImprevisto = useMutation(api.imprevistos.reopen);
  const removeImprevisto = useMutation(api.imprevistos.remove);
  const promoteImprevisto = useMutation(api.imprevistos.promote);
  const reorderImprevistos = useMutation(api.imprevistos.reorder);

  const { setNodeRef, isOver } = useDroppable({ id: HOY_PANEL_DROP_ID });

  const taskMap = useMemo(() => {
    const m = new Map<string, Doc<"tasks">>();
    for (const t of tasks) m.set(t._id, t);
    return m;
  }, [tasks]);

  const addedTaskIds = useMemo(
    () => new Set(dayItems.map((d) => d.taskId)),
    [dayItems],
  );

  /** Resultados del buscador "traer al día" (tareas ya cargadas en el tablero). */
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return tasks
      .filter(
        (t) =>
          t.deletedAt === undefined &&
          !addedTaskIds.has(t._id) &&
          t.title.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [query, tasks, addedTaskIds]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  /**
   * Redimensionado por arrastre del borde derecho. Pointer capture: los
   * pointermove/up llegan al handle aunque el puntero se pase del panel.
   * Mientras dura, se desactiva la selección de texto global (si no, se
   * selecciona todo lo que cruza el puntero).
   */
  function startResize(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = width ?? PANEL_MIN_W;
    let latest = startW;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const onMove = (ev: PointerEvent) => {
      latest = Math.min(
        PANEL_MAX_W,
        Math.max(PANEL_MIN_W, startW + (ev.clientX - startX)),
      );
      setWidth(latest);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      savePanelWidth(latest);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  /**
   * Ancho por teclado (el handle es focusable): flechas ±32px, Enter/Home
   * restaura el default. dir=0 = reset.
   */
  function nudgeWidth(dir: -1 | 1 | 0) {
    if (dir === 0) {
      setWidth(null);
      savePanelWidth(null);
      return;
    }
    setWidth((prev) => {
      const next = Math.min(
        PANEL_MAX_W,
        Math.max(PANEL_MIN_W, (prev ?? PANEL_MIN_W) + dir * 32),
      );
      savePanelWidth(next);
      return next;
    });
  }

  async function handleAddTask(taskId: Id<"tasks">) {
    try {
      await addToHoy({ sessionToken: token!, day: today, taskId });
    } catch (err) {
      if (import.meta.env.DEV) console.error("[hoy.add]", err);
      toast.error("No se pudo sumar a Hoy");
    }
  }

  async function handleCarryOver() {
    try {
      const n = await carryOver({
        sessionToken: token!,
        fromDay: yesterday,
        toDay: today,
      });
      if (n > 0) toast.success(`${n} pendiente${n === 1 ? "" : "s"} de ayer traído${n === 1 ? "" : "s"}`);
      else toast("No había pendientes de ayer para traer", { icon: "👋" });
    } catch (err) {
      if (import.meta.env.DEV) console.error("[hoy.carryOverFrom]", err);
      toast.error("No se pudieron traer los pendientes");
    }
  }

  async function handleQuickAdd() {
    const title = quickText.trim();
    if (!title) return;
    setQuickText("");
    try {
      await createImprevisto({ sessionToken: token!, title, day: today });
    } catch (err) {
      if (import.meta.env.DEV) console.error("[imprevistos.create]", err);
      toast.error("No se pudo crear el imprevisto");
    }
  }

  /** Mueve un ítem una posición dentro de SU sección y persiste el orden. */
  function moveInList<T>(list: T[], idx: number, dir: -1 | 1): T[] | null {
    const to = idx + dir;
    if (to < 0 || to >= list.length) return null;
    const next = [...list];
    [next[idx], next[to]] = [next[to], next[idx]];
    return next;
  }

  // ===== Rail colapsado =====
  if (collapsed) {
    const total = dayItems.length + imprevistos.length + abiertos.length;
    return (
      <button
        onClick={toggleCollapsed}
        title="Abrir panel Hoy"
        className="group flex h-full w-10 shrink-0 flex-col items-center gap-2 rounded-el-lg border-el border-line bg-panel py-3 text-faint shadow-el transition-colors hover:bg-panel2 hover:text-ink"
      >
        <CalendarCheck className="h-4 w-4" />
        <span className="rotate-180 [writing-mode:vertical-rl] text-xs font-medium tracking-wide">
          Hoy · {total}
        </span>
      </button>
    );
  }

  const plannedDone = dayItems.filter((d) => taskMap.get(d.taskId)?.status === "completado").length;

  return (
    <div
      ref={setNodeRef}
      style={{ width: width ?? PANEL_MIN_W }}
      className={cn(
        // transition-shadow (y no transition-all): el ancho cambia con cada
        // pointermove del resize y animarlo se sentiría gomoso.
        "relative flex h-full shrink-0 flex-col rounded-el-lg border-el border-line bg-panel shadow-el transition-shadow",
        isOver && "ring-2 ring-accent",
      )}
    >
      {/* Handle de redimensionado: borde derecho (arrastrar/doble clic). */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Ajustar ancho del panel Hoy"
        tabIndex={0}
        title="Arrastrá para agrandar · doble clic restaura el ancho"
        onPointerDown={startResize}
        onDoubleClick={() => nudgeWidth(0)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            nudgeWidth(1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            nudgeWidth(-1);
          } else if (e.key === "Enter" || e.key === "Home") {
            e.preventDefault();
            nudgeWidth(0);
          }
        }}
        className="group/handle absolute inset-y-0 right-0 z-10 flex w-2 cursor-col-resize touch-none items-center justify-center select-none"
      >
        <span className="h-10 w-1 rounded-full bg-line transition-colors group-hover/handle:bg-accent group-focus-visible/handle:bg-accent" />
      </div>
      {/* ===== Header ===== */}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <CalendarCheck className="h-4 w-4 text-accent" />
            Hoy
          </h3>
          <p className="truncate text-xs text-faint capitalize">
            {format(new Date(today), "EEEE d 'de' MMMM", { locale: es })}
          </p>
        </div>
        <button
          onClick={() => setInsightsOpen(true)}
          title="Insights de imprevistos"
          className="rounded-el p-1 text-faint transition-colors hover:bg-panel2 hover:text-ink"
        >
          <BarChart3 className="h-4 w-4" />
        </button>
        <button
          onClick={() => setSearchOpen((v) => !v)}
          title="Buscar una tarea del tablero para sumar al día"
          className={cn(
            "rounded-el p-1 text-faint transition-colors hover:bg-panel2 hover:text-ink",
            searchOpen && "bg-panel2 text-ink",
          )}
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          onClick={handleCarryOver}
          title="Traer pendientes de ayer"
          className="rounded-el p-1 text-faint transition-colors hover:bg-panel2 hover:text-ink"
        >
          <History className="h-4 w-4" />
        </button>
        <button
          onClick={toggleCollapsed}
          title="Contraer panel"
          className="rounded-el p-1 text-faint transition-colors hover:bg-panel2 hover:text-ink"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      {/* Hint de drop: solo mientras arrastrás una tarjeta encima */}
      {isOver && (
        <div className="border-b border-line bg-panel2 px-3 py-1.5 text-center text-xs font-medium text-accent">
          Soltá acá para sumar al día
        </div>
      )}

      {/* ===== Buscador (traer tareas del tablero sin drag) ===== */}
      {searchOpen && (
        <div className="border-b border-line px-3 py-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar tarea del tablero…"
            className="input text-sm"
          />
          {results.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1">
              {results.map((t) => (
                <li key={t._id}>
                  <button
                    onClick={() => {
                      void handleAddTask(t._id as Id<"tasks">);
                      setQuery("");
                      setSearchOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-el px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-panel2"
                  >
                    <StatusDot status={t.status} />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <Plus className="h-3.5 w-3.5 shrink-0 text-faint" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ===== Contenido scrolleable ===== */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        {/* --- Planeadas --- */}
        <section>
          <SectionHeader
            label="Planeadas"
            count={dayItems.length}
            hint={`${plannedDone}/${dayItems.length} hechas`}
          />
          {dayItems.length === 0 && (
            <p className="px-1 text-xs text-faint">
              Arrastrá tareas del Kanban o buscálas con la lupa.
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {dayItems.map((item, idx) => (
              <PlannedRow
                key={item._id}
                item={item}
                task={taskMap.get(item.taskId)}
                idx={idx}
                total={dayItems.length}
                onEditTask={onEditTask}
                onRemove={() =>
                  void removeFromHoy({ sessionToken: token!, id: item._id }).catch(() =>
                    toast.error("No se pudo quitar del día"),
                  )
                }
                onMove={(dir) => {
                  const next = moveInList(dayItems, idx, dir);
                  if (next)
                    void reorderHoy({ sessionToken: token!, ids: next.map((d) => d._id) }).catch(
                      () => toast.error("No se pudo reordenar"),
                    );
                }}
              />
            ))}
          </ul>
        </section>

        {/* --- Imprevistos de hoy --- */}
        <section>
          <SectionHeader label="Imprevistos" count={imprevistos.length} />
          <ul className="flex flex-col gap-0.5">
            {imprevistos.map((imp, idx) => (
              <ImprevistoRow
                key={imp._id}
                imprevisto={imp}
                today={today}
                idx={idx}
                total={imprevistos.length}
                taskMap={taskMap}
                onEditTask={onEditTask}
                onResolve={() =>
                  void (imp.resolvedAt === undefined
                    ? resolveImprevisto({ sessionToken: token!, id: imp._id })
                    : reopenImprevisto({ sessionToken: token!, id: imp._id })
                  ).catch(() => toast.error("No se pudo actualizar el imprevisto"))
                }
                onPromote={() => {
                  void promoteImprevisto({ sessionToken: token!, id: imp._id, day: today })
                    .then(() => toast.success("Promovido: la tarea quedó en en-curso y en tu día"))
                    .catch(() => toast.error("No se pudo promover"));
                }}
                onRemove={() => {
                  void removeImprevisto({ sessionToken: token!, id: imp._id }).catch(() =>
                    toast.error("No se pudo borrar el imprevisto"),
                  );
                }}
                onMove={(dir) => {
                  const next = moveInList(imprevistos, idx, dir);
                  if (next)
                    void reorderImprevistos({
                      sessionToken: token!,
                      ids: next.map((d) => d._id),
                    }).catch(() => toast.error("No se pudo reordenar"));
                }}
              />
            ))}
          </ul>
        </section>

        {/* --- Abiertos de días anteriores --- */}
        {abiertos.length > 0 && (
          <section>
            <button
              onClick={() => setShowOld((v) => !v)}
              className="flex w-full items-center gap-1.5 px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-mute"
            >
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", !showOld && "-rotate-90")}
              />
              Abiertos de días anteriores
              <span className="rounded-full border-el border-line bg-panel2 px-1.5 text-[10px] font-medium text-mute">
                {abiertos.length}
              </span>
            </button>
            {showOld && (
              <ul className="flex flex-col gap-0.5">
                {abiertos.map((imp) => (
                  <ImprevistoRow
                    key={imp._id}
                    imprevisto={imp}
                    today={today}
                    idx={0}
                    total={1}
                    old
                    taskMap={taskMap}
                    onEditTask={onEditTask}
                    onResolve={() =>
                      void (imp.resolvedAt === undefined
                        ? resolveImprevisto({ sessionToken: token!, id: imp._id })
                        : reopenImprevisto({ sessionToken: token!, id: imp._id })
                      ).catch(() => toast.error("No se pudo actualizar el imprevisto"))
                    }
                    onPromote={() => {
                      void promoteImprevisto({ sessionToken: token!, id: imp._id, day: today })
                        .then(() => toast.success("Promovido: la tarea quedó en en-curso y en tu día"))
                        .catch(() => toast.error("No se pudo promover"));
                    }}
                    onRemove={() => {
                      void removeImprevisto({ sessionToken: token!, id: imp._id }).catch(() =>
                        toast.error("No se pudo borrar el imprevisto"),
                      );
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {/* ===== Alta rápida (fricción cero: un campo, Enter, listo) ===== */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleQuickAdd();
        }}
        className="border-t border-line p-2.5"
      >
        <div className="flex items-center gap-1.5">
          <input
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            placeholder="Imprevisto que surgió…"
            className="input text-sm"
          />
          <button
            type="submit"
            disabled={!quickText.trim()}
            title="Agregar imprevisto"
            className="btn-primary flex h-8 w-8 shrink-0 items-center justify-center !p-0 disabled:opacity-40"
          >
            <Check className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 px-1 text-[10px] text-faint">
          Los imprevistos no van al tablero: se miden aparte.
        </p>
      </form>

      {/* Visor de métricas (drawer fijo, vive acá solo por conveniencia). */}
      <InsightsDrawer open={insightsOpen} onClose={() => setInsightsOpen(false)} tasks={tasks} />
    </div>
  );
}

/** Encabezado de sección con contador (lenguaje del Kanban). */
function SectionHeader({ label, count, hint }: { label: string; count: number; hint?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-mute">
      {label}
      <span className="rounded-full border-el border-line bg-panel2 px-1.5 text-[10px] font-medium text-mute">
        {count}
      </span>
      {hint && <span className="ml-auto text-[10px] font-normal normal-case text-faint">{hint}</span>}
    </div>
  );
}

/** Flechitas de reorden (hover): reordenar en el panel no toca el Kanban. */
function MoveButtons({
  idx,
  total,
  onMove,
}: {
  idx: number;
  total: number;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <span className="flex flex-col opacity-0 transition-opacity group-hover:opacity-100">
      <button
        onClick={() => onMove(-1)}
        disabled={idx === 0}
        title="Subir"
        className="rounded-el p-0.5 text-faint hover:text-ink disabled:opacity-20"
      >
        <ChevronUp className="h-3 w-3" />
      </button>
      <button
        onClick={() => onMove(1)}
        disabled={idx === total - 1}
        title="Bajar"
        className="rounded-el p-0.5 text-faint hover:text-ink disabled:opacity-20"
      >
        <ChevronDown className="h-3 w-3" />
      </button>
    </span>
  );
}

/** Fila de tarea planeada: puntero a una task del tablero. */
function PlannedRow({
  item,
  task,
  idx,
  total,
  onEditTask,
  onRemove,
  onMove,
}: {
  item: Doc<"dayItems">;
  task: Doc<"tasks"> | undefined;
  idx: number;
  total: number;
  onEditTask: (t: Doc<"tasks">) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  // La tarea pudo borrarse del tablero: el puntero sobrevive para la métrica.
  if (!task || task.deletedAt !== undefined) {
    return (
      <li className="group flex items-center gap-2 rounded-el px-1 py-1 text-faint">
        <span className="h-6 w-6 shrink-0 rounded-full border border-dashed border-line" />
        <span className="min-w-0 flex-1 truncate text-xs italic">tarea eliminada</span>
        <button
          onClick={onRemove}
          title="Quitar del día"
          className="rounded-el p-1 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </li>
    );
  }

  const clickupHref =
    task.clickupUrl ??
    (task.clickupId ? `https://app.clickup.com/t/${task.clickupId}` : undefined);

  return (
    <li className="group flex items-center gap-2 rounded-el px-1 py-1 hover:bg-panel2">
      <CompleteButton task={task} size="sm" />
      <button
        onClick={() => onEditTask(task)}
        className="min-w-0 flex-1 text-left"
        title="Abrir tarea"
      >
        <span
          className={cn(
            "block truncate text-sm",
            task.status === "completado" ? "text-faint line-through" : "text-ink",
          )}
        >
          {task.title}
        </span>
      </button>
      {clickupHref && (
        <a
          href={clickupHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Abrir en ClickUp"
          className="shrink-0 rounded-el p-0.5 text-faint opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
      <StatusDot status={task.status} />
      {item.carriedFrom && (
        <span className="text-[10px] text-faint" title="Traída de otro día">
          ↩
        </span>
      )}
      <MoveButtons idx={idx} total={total} onMove={onMove} />
      <button
        onClick={onRemove}
        title="Quitar del día (la tarea no se toca)"
        className="rounded-el p-1 text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

/** Fila de imprevisto: vida propia, sin task del tablero. */
function ImprevistoRow({
  imprevisto,
  today,
  idx,
  total,
  old = false,
  taskMap,
  onEditTask,
  onResolve,
  onPromote,
  onRemove,
  onMove,
}: {
  imprevisto: Doc<"imprevistos">;
  today: number;
  idx: number;
  total: number;
  old?: boolean;
  taskMap: Map<string, Doc<"tasks">>;
  onEditTask: (t: Doc<"tasks">) => void;
  onResolve: () => void;
  onPromote: () => void;
  onRemove: () => void;
  onMove?: (dir: -1 | 1) => void;
}) {
  const resolved = imprevisto.resolvedAt !== undefined;
  const promoted = imprevisto.promotedAt !== undefined;
  const promotedTask = imprevisto.promotedTaskId
    ? taskMap.get(imprevisto.promotedTaskId)
    : undefined;
  // La fila promovida hereda el estado de SU tarea: si la tarea ya está
  // completada, el imprevisto se muestra resuelto (el trabajo está hecho);
  // mientras la tarea viva siga abierta, queda "en curso" con su flechita.
  const promotedTaskDone =
    promotedTask !== undefined && promotedTask.status === "completado";
  const daysOpen = differenceInCalendarDays(new Date(today), new Date(imprevisto.day)) + 1;

  return (
    <li className="group flex items-center gap-2 rounded-el px-1 py-1 hover:bg-panel2">
      {/* Izquierda: el estado real del trabajo. Resuelto → check verde
          (clic = reabrir). Promovido con tarea completada → check verde
          punteado (se resuelve desde la tarea, no desde acá). Promovido
          en curso → flechita. Abierto → check para resolver. */}
      {promoted ? (
        promotedTaskDone ? (
          <span
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed border-[var(--status-completado)] bg-[var(--status-completado)] text-white"
            title="La tarea promovida está completada"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </span>
        ) : (
          <span
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed border-accent text-accent"
            title="Se transformó en tarea (en curso)"
          >
            <ArrowUpRight className="h-3 w-3" />
          </span>
        )
      ) : (
        <button
          onClick={onResolve}
          title={resolved ? "Reabrir imprevisto" : "Resolver imprevisto"}
          aria-label={resolved ? "Reabrir imprevisto" : "Resolver imprevisto"}
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-all",
            resolved
              ? "border-transparent bg-[var(--status-completado)] text-white"
              : "border-line bg-panel text-mute hover:border-[var(--status-completado)] hover:text-[var(--status-completado)]",
          )}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </button>
      )}

      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          // Tachado solo cuando el trabajo REALMENTE terminó: resuelto, o
          // promovido cuya tarea ya está completada.
          resolved || promotedTaskDone ? "text-faint line-through" : "text-ink",
        )}
        title={imprevisto.clickupSyncError ?? imprevisto.title}
      >
        {imprevisto.title}
      </span>

      {imprevisto.clickupSyncError && (
        <span
          className="shrink-0"
          title={`Sync ClickUp pendiente: ${imprevisto.clickupSyncError}`}
        >
          <TriangleAlert className="h-3.5 w-3.5 text-[#d97706]" />
        </span>
      )}

      {/* Abiertos viejos: cuántos días llevan. */}
      {old && !resolved && !promoted && (
        <span
          className="shrink-0 rounded-full border-el border-line bg-panel2 px-1.5 text-[10px] font-medium text-mute"
          title={`Surgió el ${format(new Date(imprevisto.day), "d 'de' MMMM", { locale: es })}`}
        >
          día {daysOpen}
        </span>
      )}

      {/* Promover → saltar a la tarea creada (viva: botón; eliminada: estático). */}
      {promoted &&
        (promotedTask ? (
          <button
            onClick={() => onEditTask(promotedTask)}
            title={
              promotedTaskDone
                ? "Ver la tarea (completada)"
                : "Ver la tarea (en curso, en tus Planeadas de hoy)"
            }
            className="shrink-0 rounded-el border-el border-accent/40 bg-accent/10 px-1.5 text-[10px] font-semibold text-accent hover:bg-accent/20"
          >
            → tarea{promotedTaskDone ? " ✓" : ""}
          </button>
        ) : imprevisto.promotedTaskId ? (
          <span
            className="shrink-0 rounded-el border-el border-line px-1.5 text-[10px] font-medium text-faint"
            title="La tarea promovida fue eliminada del tablero"
          >
            → tarea
          </span>
        ) : (
          <span className="shrink-0 text-[10px] text-faint" title="Creando la tarea…">
            promoviendo…
          </span>
        ))}
      {!promoted && !resolved && (
        <button
          onClick={onPromote}
          title="Promover a tarea del tablero (sale de imprevistos y pasa a Mesa Técnica)"
          className="shrink-0 rounded-el p-1 text-faint opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      )}

      {onMove && !old && <MoveButtons idx={idx} total={total} onMove={onMove} />}
      <button
        onClick={onRemove}
        title="Borrar imprevisto"
        className="rounded-el p-1 text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
