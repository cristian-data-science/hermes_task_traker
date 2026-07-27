import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  pointerWithin,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { useMutation } from "convex/react";
import type { Doc } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import { KANBAN_COLUMNS, STATUS_META, type Status } from "../lib/constants";
import { TaskCard } from "./TaskCard";
import { useSubtaskCounts } from "../hooks/useSubtaskCounts";

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
      <div className="flex h-full gap-3 overflow-x-auto px-1 pb-2">
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

/** Una columna del Kanban (también actúa como droppable vía su id = status). */
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
  return (
    <div className="flex w-72 shrink-0 flex-col">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${meta.dot}`} />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {meta.emoji} {meta.label}
          </h3>
          <span className="rounded-full bg-slate-200 px-1.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
            {tasks.length}
          </span>
        </div>
        <button
          onClick={onNewTask}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          title="Nueva tarea"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Drop zone: el id coincide con el status para detectar drop en vacío */}
      <div
        id={status}
        data-status={status}
        className="flex flex-1 flex-col gap-2 overflow-y-auto rounded-xl bg-slate-100/60 p-2 dark:bg-slate-900/40"
        style={{ minHeight: 80 }}
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
          <div className="flex h-20 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 text-xs text-slate-400 dark:border-slate-800">
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
