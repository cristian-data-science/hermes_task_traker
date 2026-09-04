import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  pointerWithin,
  closestCorners,
  MeasuringStrategy,
  type CollisionDetection,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSnapToStatus } from "../hooks/useSnapToStatus";
import {
  Plus,
  Inbox,
  Columns3,
  Eye,
  EyeOff,
  FolderTree,
  Loader2,
  ChevronLeft,
  ChevronRight,
  LocateFixed,
} from "lucide-react";
import { useMutation, useQuery, useAction } from "convex/react";
import toast from "react-hot-toast";
import type { Doc, Id } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import { KANBAN_COLUMNS, STATUSES, STATUS_META, type Status } from "../lib/constants";
import { TaskCard } from "./TaskCard";
import { StatusDot } from "./Badges";
import { useSubtaskCounts } from "../hooks/useSubtaskCounts";
import { useHiddenColumns } from "../hooks/useHiddenColumns";
import { useGroupByProject } from "../hooks/useGroupByProject";
import {
  groupOfTask,
  groupRanks,
  subtitleOfTask,
  findAmbiguousListNames,
  type GroupOptions,
} from "../lib/projectGroup";
import { useAuth } from "../hooks/useAuth";
import { MouseSensor, TouchSensor } from "../lib/dndSensors";
import { cn, isSuperUrgent } from "../lib/utils";
import { startOfDay } from "date-fns";
import { HoyPanel, HOY_PANEL_DROP_ID } from "./HoyPanel";

interface KanbanViewProps {
  tasks: Doc<"tasks">[];
  onEditTask: (task: Doc<"tasks">) => void;
  onNewTask: (status: Status) => void;
}

type Cols = Record<Status, string[]>;

/**
 * Colisión híbrida: precisión del puntero primero; si el puntero está
 * sobre un hueco/padding, cae a closestCorners para no perder el target.
 */
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : closestCorners(args);
};

export function KanbanView({ tasks, onEditTask, onNewTask }: KanbanViewProps) {
  const changeStatus = useMutation(api.tasks.changeStatus);
  const reorderWithinStatus = useMutation(api.tasks.reorderWithinStatus);
  const addToHoy = useMutation(api.hoy.add);
  const counts = useSubtaskCounts(tasks);
  const { token } = useAuth();
  // Día actual (medianoche local) para los drops sobre el panel Hoy. El
  // cliente decide el día; el backend solo compara números (patrón catch-up).
  const hoyDay = startOfDay(new Date()).getTime();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Status | null>(null);
  // Panéo horizontal con la ruedita (middle-drag): agarrás el tablero y lo
  // arrastrás como un dedo en pantalla. `panning` solo alimenta el cursor.
  const [panning, setPanning] = useState(false);
  const panRef = useRef<{ startX: number; startScroll: number } | null>(null);
  const { isHidden, toggle, showAll, hidden } = useHiddenColumns();
  const { enabled: groupByProject, toggle: toggleGrouping } =
    useGroupByProject();
  const clickupState = useQuery(
    api.settings.getClickupState,
    token ? { sessionToken: token } : "skip",
  );

  /**
   * Opciones de agrupación. `mesaListId` sale de la config para que las
   * tareas de Mesa Técnica caigan en "Sueltas"; los nombres ambiguos se
   * calculan sobre las tareas visibles.
   */
  /**
   * ¿Hay al menos una tarea con proyecto resuelto? Si no, agrupar no puede
   * hacer nada y hay que decirlo en pantalla.
   */
  const nothingResolved = useMemo(
    () => !tasks.some((t) => !!t.clickupPath?.listName),
    [tasks],
  );
  const backfillPaths = useAction(api.clickup.backfillClickupPaths);
  const [resolving, setResolving] = useState(false);

  /**
   * Relee desde ClickUp dónde vive cada tarea.
   *
   * `refreshAll = false` solo completa las que no tienen ubicación. Sirve para
   * el arranque, pero NO arregla una tarea que se movió de proyecto en
   * ClickUp: esa ya tiene ruta, aunque sea la vieja, y el backfill la saltea.
   * Por eso el menú ofrece la versión completa — sin ella no había ninguna
   * forma de corregir una ubicación desactualizada.
   */
  async function handleResolveProjects(refreshAll = false) {
    setResolving(true);
    try {
      const r = (await backfillPaths({
        sessionToken: token!,
        refreshAll,
      })) as {
        updated: number;
        failed: number;
        total: number;
      };
      toast.success(
        r.total === 0
          ? "No hay tareas sincronizadas para resolver"
          : `${r.updated} de ${r.total} ubicaciones resueltas` +
              (r.failed > 0 ? ` · ${r.failed} sin resolver` : ""),
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudieron resolver",
      );
    } finally {
      setResolving(false);
    }
  }

  const groupOpts = useMemo<GroupOptions>(
    () => ({
      mesaListId: clickupState?.config?.mesaTecnica?.listId,
      ambiguousListNames: findAmbiguousListNames(tasks),
    }),
    [clickupState?.config?.mesaTecnica?.listId, tasks],
  );
  const [menuOpen, setMenuOpen] = useState(false);

  // ---- Estado optimista de columnas (ids ordenados por estado) ----
  const taskMap = useMemo(() => {
    const m: Record<string, Doc<"tasks">> = {};
    for (const t of tasks) m[t._id] = t;
    return m;
  }, [tasks]);

  const serverCols = useMemo<Cols>(() => {
    const map = {} as Cols;
    for (const s of KANBAN_COLUMNS) map[s] = [];
    for (const t of tasks) {
      if (map[t.status]) map[t.status].push(t._id);
    }
    for (const s of KANBAN_COLUMNS) {
      // Completado es un LOG, no una columna que se acomoda: siempre la más
      // reciente arriba (por completedAt), sin importar el order histórico.
      map[s].sort((a, b) =>
        s === "completado"
          ? (taskMap[b].completedAt ?? 0) - (taskMap[a].completedAt ?? 0)
          : taskMap[a].order - taskMap[b].order,
      );
      if (!groupByProject) continue;
      // Con agrupación activa, las tarjetas se parten por grupo conservando el
      // orden del usuario dentro de cada uno. Se ordena el MISMO array que
      // consume dnd-kit, así lo que ves y lo que se persiste al soltar no se
      // separan nunca.
      const ranks = groupRanks(
        map[s].map((id) => taskMap[id]),
        groupOpts,
      );
      map[s].sort((a, b) => {
        const ra = ranks.get(groupOfTask(taskMap[a], groupOpts).key) ?? 0;
        const rb = ranks.get(groupOfTask(taskMap[b], groupOpts).key) ?? 0;
        if (ra !== rb) return ra - rb;
        return s === "completado"
          ? (taskMap[b].completedAt ?? 0) - (taskMap[a].completedAt ?? 0)
          : taskMap[a].order - taskMap[b].order;
      });
    }
    // Capa "súper urgente": pase final que las ancla PRIMERAS de su columna,
    // por encima del orden del usuario y del agrupamiento por proyecto. El
    // sort es estable, así que entre súper urgentes se conserva su order. Si
    // el usuario arrastra una hacia abajo, al re-derivarse las columnas del
    // servidor vuelve sola a la punta: es su naturaleza.
    for (const s of KANBAN_COLUMNS) {
      map[s].sort(
        (a, b) =>
          Number(isSuperUrgent(taskMap[b])) - Number(isSuperUrgent(taskMap[a])),
      );
    }
    return map;
  }, [tasks, taskMap, groupByProject, groupOpts]);

  // Estado optimista SOLO durante el drag; fuera de él, las columnas se
  // derivan directamente del servidor (sin estado stale que se
  // dessincronice al filtrar/buscar).
  const [optimisticCols, setOptimisticCols] = useState<Cols | null>(null);
  const cols: Cols = optimisticCols ?? serverCols;
  const latestServer = useRef(serverCols);
  const pending = useRef(false);
  // Encuadre por estado (solo móvil): scroll-snap por columna + botones de
  // salto. OFF = el scroll libre de siempre. Preferencia persistida.
  const { enabled: snapEnabled, toggle: toggleSnap } = useSnapToStatus();
  const boardScrollRef = useRef<HTMLDivElement>(null);

  /** Salta al estado anterior/siguiente, alineado al inicio de su columna. */
  function navigateStatus(dir: -1 | 1) {
    const el = boardScrollRef.current;
    if (!el) return;
    const cols = Array.from(el.children) as HTMLElement[];
    if (cols.length === 0) return;
    const step = cols[0].getBoundingClientRect().width + 12; // ancho + gap
    const idx = Math.round(el.scrollLeft / step);
    const target = Math.min(Math.max(idx + dir, 0), cols.length - 1);
    cols[target].scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }
  latestServer.current = serverCols;

  // ===== Panéo horizontal con la ruedita (middle-drag) =====

  /** ¿Este middle-click es candidato a panéo? Los <a> conservan su gesto
      nativo (ruedita sobre el link de ClickUp = abrir en pestaña nueva) y
      durante un drag de tarea no se pelea el puntero. */
  function isPanCandidate(e: {
    button: number;
    target: EventTarget | null;
  }): boolean {
    return (
      e.button === 1 &&
      !activeId &&
      !((e.target as HTMLElement | null)?.closest?.("a") ?? false)
    );
  }

  /** Fase captura ANTES de que el evento llegue a las tarjetas: arranca el
      panéo y frena la propagación (así dnd-kit jamás ve la ruedita). */
  function handleBoardPanDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!isPanCandidate(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = boardScrollRef.current;
    if (!el) return;
    panRef.current = { startX: e.clientX, startScroll: el.scrollLeft };
    // Captura del puntero: el gesto sigue aunque el mouse salga del tablero.
    el.setPointerCapture(e.nativeEvent.pointerId);
    setPanning(true);
  }

  /** El mousedown de la ruedita tiene como acción default el autoscroll
      nativo del navegador; se anula acá porque pointerdown preventDefault
      no lo cubre. Solo cuando el gesto es nuestro (mismo filtro). */
  function handleBoardMouseDown(e: ReactMouseEvent<HTMLDivElement>) {
    if (isPanCandidate(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function handleBoardPanMove(e: ReactPointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    const el = boardScrollRef.current;
    if (!pan || !el) return;
    el.scrollLeft = pan.startScroll - (e.clientX - pan.startX);
  }

  function handleBoardPanEnd(e: ReactPointerEvent<HTMLDivElement>) {
    if (!panRef.current) return;
    panRef.current = null;
    setPanning(false);
    try {
      boardScrollRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // El capture ya se liberó solo (p.ej. pointer cancelado): no importa.
    }
  }

  function findContainer(id: string): Status | null {
    if ((KANBAN_COLUMNS as string[]).includes(id)) return id as Status;
    for (const s of KANBAN_COLUMNS) {
      if (cols[s].includes(id)) return s;
    }
    return null;
  }

  // ---- Sensores: mouse preciso, touch con delay (no pelea con el scroll) ----
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setOverCol(findContainer(String(e.active.id)));
  }

  /** Preview en vivo: mover la tarjeta de columna mientras se arrastra. */
  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const from = findContainer(String(active.id));
    const to = findContainer(String(over.id));
    if (!from || !to) return;
    setOverCol(to);
    if (from === to) return;

    setOptimisticCols((prev) => {
      const base = prev ?? latestServer.current;
      const fromItems = base[from].filter((i) => i !== String(active.id));
      const toItems = [...base[to]];

      let idx = toItems.indexOf(String(over.id));
      if (idx === -1) {
        idx = toItems.length; // soltó sobre la columna → al final
      } else {
        // Insertar antes o después según la posición vertical del puntero
        const activeRect = active.rect.current.translated;
        const overRect = over.rect;
        const below =
          activeRect != null &&
          activeRect.top > overRect.top + overRect.height / 2;
        if (below) idx += 1;
      }
      toItems.splice(idx, 0, String(active.id));
      return { ...base, [from]: fromItems, [to]: toItems };
    });
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    const id = String(active.id);
    setActiveId(null);
    setOverCol(null);

    // ===== Drop sobre el panel Hoy =====
    // Suma la tarea al día SIN tocar su columna: findContainer no conoce el
    // panel (handleDragOver es no-op allá), así que la tarjeta vuelve sola a
    // su columna y acá solo queda registrar el puntero.
    if (over && String(over.id) === HOY_PANEL_DROP_ID) {
      const task = taskMap[id];
      if (task) {
        addToHoy({ day: hoyDay, taskId: task._id as Id<"tasks">, sessionToken: token! })
          .then(() => toast.success("Sumada a Hoy"))
          .catch((err) => {
            if (import.meta.env.DEV) console.error("[hoy.add]", err);
            toast.error("No se pudo sumar a Hoy");
          });
      }
      setOptimisticCols(null);
      return;
    }

    const task = taskMap[id];
    const container = findContainer(id);
    if (!task || !container) return;

    // Reordenar dentro de la columna final si soltó sobre otra tarjeta
    let finalItems = cols[container];
    if (over && String(over.id) !== id) {
      const overContainer = findContainer(String(over.id));
      if (overContainer === container) {
        const oldIdx = finalItems.indexOf(id);
        const newIdx = finalItems.indexOf(String(over.id));
        if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
          finalItems = arrayMove(finalItems, oldIdx, newIdx);
          setOptimisticCols((prev) => {
            const base = prev ?? latestServer.current;
            return { ...base, [container]: finalItems };
          });
        }
      }
    }

    const newOrder = finalItems.indexOf(id);
    const statusChanged = task.status !== container;
    const orderChanged = newOrder !== task.order;
    if (!statusChanged && !orderChanged) return; // nada que guardar

    // Commit al servidor (el estado optimista ya refleja el cambio)
    pending.current = true;
    const mutation = statusChanged
      ? changeStatus({
          id: task._id as Id<"tasks">,
          newStatus: container,
          newOrder,
          sessionToken: token!,
        })
      : reorderWithinStatus({
          id: task._id as Id<"tasks">,
          newOrder,
          sessionToken: token!,
        });

    mutation
      .catch((err) => {
        if (import.meta.env.DEV) console.error(err);
        toast.error("No se pudo mover la tarea");
      })
      .finally(() => {
        // El servidor ya aplicó el cambio: descartar el estado optimista
        // para que las columnas vuelvan a derivarse del servidor (y así
        // reflejar también mutations externas como toggleComplete).
        pending.current = false;
        setOptimisticCols(null);
      });
  }

  function handleDragCancel() {
    setActiveId(null);
    setOverCol(null);
    setOptimisticCols(null);
  }

  const activeTask = activeId ? taskMap[activeId] : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* Barra superior: agrupar por proyecto + columnas visibles */}
      <div className="relative mb-2 flex items-center justify-end gap-2 px-1">
        <button
          onClick={toggleGrouping}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-el border-el border-line px-2.5 py-1.5 text-xs font-medium transition-colors",
            groupByProject
              ? "bg-accent text-acfg"
              : "bg-panel2 text-mute hover:text-ink",
          )}
          title={
            groupByProject
              ? "Agrupado por proyecto. Arrastrar entre grupos NO cambia el proyecto: para eso, el destino ClickUp del modal."
              : "Agrupar las tarjetas por proyecto de ClickUp"
          }
        >
          <FolderTree className="h-3.5 w-3.5" />
          Proyectos
        </button>

        <button
          onClick={() => setMenuOpen((o) => !o)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-el border-el border-line bg-panel2 px-2.5 py-1.5 text-xs font-medium transition-colors",
            menuOpen ? "text-ink ring-1 ring-accent" : "text-mute hover:text-ink",
          )}
          title="Mostrar / ocultar columnas"
        >
          <Columns3 className="h-3.5 w-3.5" />
          Columnas
          {hidden.length > 0 && (
            <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-acfg">
              {hidden.length}
            </span>
          )}
        </button>

        {/* Encuadre por estado (solo móvil): snap por columna + flechas de
            salto. En desktop no se muestran: la web de escritorio no cambia. */}
        <div className="hidden items-center gap-1 sm:flex">
          <button
            onClick={toggleSnap}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-el border-el border-line px-2.5 py-1.5 text-xs font-medium transition-colors",
              snapEnabled
                ? "bg-accent text-acfg"
                : "bg-panel2 text-mute hover:text-ink",
            )}
            title={
              snapEnabled
                ? "Encuadre por estado activo: cada swipe deja un estado completo. Clic para scroll libre."
                : "Scroll libre. Clic para encuadrar por estado al deslizar."
            }
          >
            <LocateFixed className="h-3.5 w-3.5" />
            Encuadre
          </button>
          {snapEnabled && (
            <>
              <button
                onClick={() => navigateStatus(-1)}
                title="Estado anterior"
                aria-label="Estado anterior"
                className="inline-flex items-center rounded-el border-el border-line bg-panel2 px-1.5 py-1.5 text-mute transition-colors hover:text-ink"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => navigateStatus(1)}
                title="Estado siguiente"
                aria-label="Estado siguiente"
                className="inline-flex items-center rounded-el border-el border-line bg-panel2 px-1.5 py-1.5 text-mute transition-colors hover:text-ink"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>

        {menuOpen && (
          <>
            {/* Cerrar al clicar fuera */}
            <div
              className="fixed inset-0 z-10"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-el-lg border-el border-line bg-panel p-1.5 shadow-el-lg">
              <div className="mb-1 flex items-center justify-between px-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-faint">
                  Mostrar columnas
                </span>
                {hidden.length > 0 && (
                  <button
                    onClick={showAll}
                    className="text-[10px] font-semibold text-accent hover:underline"
                  >
                    Mostrar todo
                  </button>
                )}
              </div>
              {STATUSES.map((s) => {
                const meta = STATUS_META[s];
                const hidden_ = isHidden(s);
                return (
                  <button
                    key={s}
                    onClick={() => toggle(s)}
                    style={{ "--tone": meta.tone } as CSSProperties}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-el px-1.5 py-1.5 text-sm transition-colors hover:bg-panel2",
                      hidden_ && "opacity-50",
                    )}
                  >
                    <meta.Icon
                      className="h-3.5 w-3.5 shrink-0"
                      style={{ color: "var(--tone)" }}
                    />
                    <span className="flex-1 text-left text-ink">{meta.label}</span>
                    {hidden_ ? (
                      <EyeOff className="h-3.5 w-3.5 text-faint" />
                    ) : (
                      <Eye className="h-3.5 w-3.5 text-mute" />
                    )}
                  </button>
                );
              })}

              {/* Mantenimiento de la agrupación por proyecto.
                  Vive en el menú y no en el aviso de abajo porque ese aviso
                  solo aparece cuando NINGUNA tarea tiene proyecto resuelto:
                  una vez resuelta la primera, desaparecía y ya no quedaba
                  ninguna forma de recalcular una ubicación que cambió. */}
              <div className="mt-1 border-t border-line pt-1">
                <span className="block px-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-faint">
                  Proyectos
                </span>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    void handleResolveProjects(true);
                  }}
                  disabled={resolving}
                  className="flex w-full items-center gap-2 rounded-el px-1.5 py-1.5 text-sm transition-colors hover:bg-panel2 disabled:opacity-60"
                >
                  {resolving ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
                  ) : (
                    <FolderTree className="h-3.5 w-3.5 shrink-0 text-accent" />
                  )}
                  <span className="flex-1 text-left text-ink">
                    Recalcular ubicaciones
                  </span>
                </button>
                <p className="px-1.5 pb-1 text-[10px] leading-tight text-faint">
                  Relee de ClickUp en qué proyecto vive cada tarea. Usalo si
                  moviste algo de list y quedó agrupado donde no va.
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Aviso cuando la agrupación no tiene con qué agrupar: sin esto, el
          tablero se ve igual que sin agrupar y no hay pista del motivo. */}
      {groupByProject && nothingResolved && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-el border-el border-line bg-panel2 px-3 py-2 text-xs text-mute">
          <FolderTree className="h-4 w-4 shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            Ninguna tarea tiene su proyecto resuelto todavía, así que todas
            caen en «Sueltas».
          </span>
          <button
            onClick={() => void handleResolveProjects(false)}
            disabled={resolving}
            className="btn-primary shrink-0 px-2.5 py-1 text-[11px] disabled:opacity-60"
          >
            {resolving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderTree className="h-3.5 w-3.5" />
            )}
            Resolver ahora
          </button>
        </div>
      )}

      {/* Panel Hoy a la izquierda + tablero: comparten el DndContext para que
          las tarjetas se puedan soltar sobre el panel y queden sumadas al día. */}
      <div className="flex w-full items-start gap-3">
        <HoyPanel tasks={tasks} onEditTask={onEditTask} />

        {/* Scroll horizontal; el snap móvil se desactiva durante el drag.
            Con "Encuadre por estado" activo, cada swipe queda alineado a un
            estado completo; con la preferencia OFF, scroll libre como siempre. */}
        <div
          ref={boardScrollRef}
          onPointerDownCapture={handleBoardPanDown}
          onMouseDownCapture={handleBoardMouseDown}
          onPointerMove={handleBoardPanMove}
          onPointerUp={handleBoardPanEnd}
          onPointerCancel={handleBoardPanEnd}
          className={cn(
            "flex h-full min-w-0 flex-1 gap-3 overflow-x-auto px-1 pb-2",
            panning && "cursor-ew-resize select-none",
            activeId
              ? "snap-none"
              : snapEnabled
                ? "snap-x snap-mandatory sm:snap-none"
                : "sm:snap-none",
          )}
        >
          {KANBAN_COLUMNS.filter((s) => !isHidden(s)).map((status) => (
            <Column
              key={status}
              status={status}
              ids={cols[status]}
              taskMap={taskMap}
              counts={counts}
              highlight={activeId !== null && overCol === status}
              onEditTask={onEditTask}
              onNewTask={() => onNewTask(status)}
              groupByProject={groupByProject}
              groupOpts={groupOpts}
            />
          ))}
        </div>
      </div>

      {/* Clon flotante: única tarjeta en movimiento (la original queda como hueco) */}
      <DragOverlay>
        {activeTask ? (
          <div className="rotate-[1.5deg] scale-[1.03] cursor-grabbing shadow-el-lg">
            <TaskCard
              task={activeTask}
              subtaskCount={counts[activeTask._id]}
              variant="kanban"
              layoutAnim={false}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Columna sortable del Kanban. */
function Column({
  status,
  ids,
  taskMap,
  counts,
  highlight,
  onEditTask,
  onNewTask,
  groupByProject,
  groupOpts,
}: {
  status: Status;
  ids: string[];
  taskMap: Record<string, Doc<"tasks">>;
  counts: Record<string, { done: number; total: number }>;
  highlight: boolean;
  onEditTask: (t: Doc<"tasks">) => void;
  onNewTask: () => void;
  groupByProject: boolean;
  groupOpts: GroupOptions;
}) {
  const meta = STATUS_META[status];
  const { setNodeRef } = useDroppable({
    id: status,
    data: { type: "column", status },
  });

  /** Cuántas tarjetas tiene cada grupo en esta columna (para el contador). */
  const groupSizes = useMemo(() => {
    const m = new Map<string, number>();
    if (!groupByProject) return m;
    for (const id of ids) {
      const k = groupOfTask(taskMap[id], groupOpts).key;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [ids, taskMap, groupByProject, groupOpts]);

  return (
    <div className="flex w-[82vw] shrink-0 snap-start snap-always flex-col sm:w-72">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <StatusDot status={status} />
          <h3
            className="flex items-center gap-1.5 text-sm font-semibold text-ink"
            style={{ "--tone": meta.tone } as CSSProperties}
          >
            <meta.Icon className="h-4 w-4" style={{ color: "var(--tone)" }} />
            {meta.label}
          </h3>
          <span className="rounded-full border-el border-line bg-panel2 px-1.5 text-xs font-medium text-mute">
            {ids.length}
          </span>
        </div>
        <button
          onClick={onNewTask}
          className="rounded-el p-1 text-faint transition-colors hover:bg-panel2 hover:text-ink"
          title="Nueva tarea"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Drop zone + lista sortable */}
      <div
        ref={setNodeRef}
        style={{ "--tone": meta.tone, minHeight: 140 } as CSSProperties}
        className={cn(
          "flex flex-1 flex-col gap-2 rounded-el-lg p-2 transition-all duration-150",
          highlight
            ? "bg-panel2 ring-2 ring-accent"
            : "col-drop ring-1 ring-transparent",
        )}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((id, i) => {
            // Encabezado de grupo cuando cambia respecto de la tarjeta
            // anterior. Como el array ya viene particionado por grupo, sale
            // exactamente uno por grupo. Si la columna tiene un solo grupo no
            // se dibuja: no aportaría nada.
            const group = groupByProject
              ? groupOfTask(taskMap[id], groupOpts)
              : null;
            const prevGroup =
              groupByProject && i > 0
                ? groupOfTask(taskMap[ids[i - 1]], groupOpts)
                : null;
            // Antes se ocultaba el encabezado cuando la columna tenía un
            // solo grupo. Parecía elegante, pero cuando TODO caía en
            // "Sueltas" el resultado era una línea de color sin ninguna
            // explicación: la función no andaba y no había forma de saberlo.
            const showHeader = !!group && group.key !== prevGroup?.key;
            return (
              <div key={id} className={cn(showHeader && "mt-1 first:mt-0")}>
                {showHeader && group && (
                  <div className="mb-1 flex items-center gap-1.5 px-0.5">
                    <span
                      className={cn(
                        "h-3 w-[3px] shrink-0 rounded-sm",
                        group.isLoose ? "bg-line2" : "bg-accent",
                      )}
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-[11px] font-medium",
                        group.isLoose ? "text-mute" : "text-accent",
                      )}
                      title={group.label}
                    >
                      {group.label}
                    </span>
                    <span className="shrink-0 text-[10px] text-faint">
                      {groupSizes.get(group.key) ?? 0}
                    </span>
                  </div>
                )}
                <div
                  className={cn(
                    groupByProject &&
                      "border-l-2 pl-1.5 " +
                        (group?.isLoose ? "border-line" : "border-accent/30"),
                  )}
                >
                  <SortableTask
                    task={taskMap[id]}
                    count={counts[id]}
                    subtitle={
                      groupByProject ? subtitleOfTask(taskMap[id]) : ""
                    }
                    onClick={() => onEditTask(taskMap[id])}
                  />
                </div>
              </div>
            );
          })}
        </SortableContext>
        {ids.length === 0 && (
          <div
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 rounded-el border-2 border-dashed text-xs transition-colors",
              highlight
                ? "border-accent text-accent"
                : "border-line text-faint",
            )}
          >
            <Inbox className="h-4 w-4" />
            Suelta aquí
          </div>
        )}
      </div>
    </div>
  );
}

/** Tarjeta sortable: el wrapper recibe los transforms de dnd-kit. */
function SortableTask({
  task,
  count,
  onClick,
  subtitle,
}: {
  task: Doc<"tasks">;
  count?: { done: number; total: number };
  onClick: () => void;
  /** Ruta dentro del proyecto ("FASE 1 › Correcciones"), si se agrupa. */
  subtitle?: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task._id,
    data: { status: task.status },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
      className={cn(
        "touch-manipulation",
        isDragging ? "cursor-grabbing" : "cursor-grab",
      )}
    >
      {/* Mientras se arrastra, la original queda como hueco tenue */}
      <div className={cn(isDragging && "opacity-30 grayscale")}>
        <TaskCard
          task={task}
          subtaskCount={count}
          subtitle={subtitle}
          layoutAnim={false}
          onClick={() => {
            if (!isDragging) onClick();
          }}
          variant="kanban"
        />
      </div>
    </div>
  );
}
