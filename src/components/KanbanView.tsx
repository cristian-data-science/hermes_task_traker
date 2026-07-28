import { useMemo, useState, type CSSProperties } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Plus, Inbox } from "lucide-react";
import { useMutation } from "convex/react";
import type { Doc } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import { KANBAN_COLUMNS, STATUS_META, type Status } from "../lib/constants";
import { TaskCard } from "./TaskCard";
import { StatusDot } from "./Badges";
import { useSubtaskCounts } from "../hooks/useSubtaskCounts";
import { cn } from "../lib/utils";

interface KanbanViewProps {
  tasks: Doc<"tasks">[];
  onEditTask: (task: Doc<"tasks">) => void;
  onNewTask: (status: Status) => void;
}

export function KanbanView({ tasks, onEditTask, onNewTask }: KanbanViewProps) {
  const changeStatus = useMutation(api.tasks.changeStatus);
  const reorderWithinStatus = useMutation(api.tasks.reorderWithinStatus);
  const counts = useSubtaskCounts(tasks);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Agrupar tareas por estado, ordenadas por `order`
  const byStatus = useMemo(() => {
    const map: Record<string, Doc<"tasks">[]> = {};
    for (const s of KANBAN_COLUMNS) map[s] = [];
    for (const t of tasks) {
      if (map[t.status]) map[t.status].push(t);
    }
    for (const s of KANBAN_COLUMNS) map[s].sort((a, b) => a.order - b.order);
    return map;
  }, [tasks]);

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const activeTask = tasks.find((t) => t._id === active.id);
    if (!activeTask) return;

    const overId = String(over.id);
    let targetStatus: Status;
    let targetIndex: number;

    if ((KANBAN_COLUMNS as string[]).includes(overId)) {
      // Soltó sobre columna vacía → al final
      targetStatus = overId as Status;
      targetIndex = byStatus[targetStatus].length;
    } else {
      // Soltó sobre una tarea
      const overTask = tasks.find((t) => t._id === over.id);
      if (!overTask) return;
      targetStatus = overTask.status;
      const col = byStatus[targetStatus];
      targetIndex = col.findIndex((t) => t._id === over.id);
      if (targetIndex < 0) targetIndex = col.length;
    }

    try {
      if (activeTask.status !== targetStatus) {
        await changeStatus({
          id: activeTask._id,
          newStatus: targetStatus,
          newOrder: targetIndex,
        });
      } else {
        await reorderWithinStatus({
          id: activeTask._id,
          newOrder: targetIndex,
        });
      }
    } catch (err) {
      console.error(err);
    }
  }

  const activeTask = activeId ? tasks.find((t) => t._id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {/* Scroll horizontal con snap en móvil */}
      <div className="flex h-full snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 sm:snap-none">
        {KANBAN_COLUMNS.map((status) => (
          <Column
            key={status}
            status={status}
            tasks={byStatus[status]}
            counts={counts}
            onEditTask={onEditTask}
            onNewTask={() => onNewTask(status)}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="w-72 rotate-2 opacity-90">
            <TaskCard
              task={activeTask}
              subtaskCount={counts[activeTask._id]}
              variant="kanban"
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Una columna del Kanban. Es droppable con id = status. */
function Column({
  status,
  tasks,
  counts,
  onEditTask,
  onNewTask,
}: {
  status: Status;
  tasks: Doc<"tasks">[];
  counts: Record<string, { done: number; total: number }>;
  onEditTask: (t: Doc<"tasks">) => void;
  onNewTask: () => void;
}) {
  const meta = STATUS_META[status];
  const { setNodeRef, isOver } = useDroppable({
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
            {tasks.length}
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

      {/* Drop zone registrada con useDroppable */}
      <div
        ref={setNodeRef}
        style={{ "--tone": meta.tone, minHeight: 80 } as CSSProperties}
        className={cn(
          "flex flex-1 flex-col gap-2 overflow-y-auto rounded-el-lg p-2 transition-all",
          isOver ? "bg-panel2 ring-2 ring-accent" : "col-drop ring-1 ring-transparent",
        )}
      >
        {tasks.map((task) => (
          <DraggableTask
            key={task._id}
            task={task}
            count={counts[task._id]}
            onClick={() => onEditTask(task)}
          />
        ))}
        {tasks.length === 0 && (
          <div className="flex h-20 flex-col items-center justify-center gap-1 rounded-el border-2 border-dashed border-line text-xs text-faint">
            <Inbox className="h-4 w-4" />
            Suelta aquí
          </div>
        )}
      </div>
    </div>
  );
}

/** Tarjeta draggable dentro de una columna. */
function DraggableTask({
  task,
  count,
  onClick,
}: {
  task: Doc<"tasks">;
  count?: { done: number; total: number };
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: task._id,
      data: { status: task.status },
    });

  const style: React.CSSProperties | undefined = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 50,
      }
    : undefined;

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <TaskCard
        task={task}
        subtaskCount={count}
        onClick={() => {
          if (!isDragging) onClick();
        }}
        variant="kanban"
      />
    </div>
  );
}
