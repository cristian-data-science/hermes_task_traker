import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
import { Plus, Inbox, Columns3, Eye, EyeOff } from "lucide-react";
import { useMutation } from "convex/react";
import toast from "react-hot-toast";
import type { Doc, Id } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import { KANBAN_COLUMNS, STATUSES, STATUS_META, type Status } from "../lib/constants";
import { TaskCard } from "./TaskCard";
import { StatusDot } from "./Badges";
import { useSubtaskCounts } from "../hooks/useSubtaskCounts";
import { useHiddenColumns } from "../hooks/useHiddenColumns";
import { MouseSensor, TouchSensor } from "../lib/dndSensors";
import { cn } from "../lib/utils";

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
  const counts = useSubtaskCounts(tasks);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Status | null>(null);
  const { isHidden, toggle, showAll, hidden } = useHiddenColumns();
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
      map[s].sort((a, b) => taskMap[a].order - taskMap[b].order);
    }
    return map;
  }, [tasks, taskMap]);

  // Estado optimista SOLO durante el drag; fuera de él, las columnas se
  // derivan directamente del servidor (sin estado stale que se
  // dessincronice al filtrar/buscar).
  const [optimisticCols, setOptimisticCols] = useState<Cols | null>(null);
  const cols: Cols = optimisticCols ?? serverCols;
  const latestServer = useRef(serverCols);
  const pending = useRef(false);
  latestServer.current = serverCols;

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
        })
      : reorderWithinStatus({ id: task._id as Id<"tasks">, newOrder });

    mutation
      .catch((err) => {
        console.error(err);
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
      {/* Barra superior: toggle de columnas visibles */}
      <div className="relative mb-2 flex items-center justify-end px-1">
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
            </div>
          </>
        )}
      </div>

      {/* Scroll horizontal; el snap móvil se desactiva durante el drag */}
      <div
        className={cn(
          "flex h-full gap-3 overflow-x-auto px-1 pb-2",
          activeId ? "snap-none" : "snap-x snap-mandatory sm:snap-none",
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
          />
        ))}
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
}: {
  status: Status;
  ids: string[];
  taskMap: Record<string, Doc<"tasks">>;
  counts: Record<string, { done: number; total: number }>;
  highlight: boolean;
  onEditTask: (t: Doc<"tasks">) => void;
  onNewTask: () => void;
}) {
  const meta = STATUS_META[status];
  const { setNodeRef } = useDroppable({
    id: status,
    data: { type: "column", status },
  });

  return (
    <div className="flex w-[82vw] shrink-0 snap-start flex-col sm:w-72">
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
          {ids.map((id) => (
            <SortableTask
              key={id}
              task={taskMap[id]}
              count={counts[id]}
              onClick={() => onEditTask(taskMap[id])}
            />
          ))}
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
}: {
  task: Doc<"tasks">;
  count?: { done: number; total: number };
  onClick: () => void;
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
