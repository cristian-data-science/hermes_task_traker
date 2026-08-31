import { useMemo, useState, type CSSProperties } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  Plus,
  Calendar,
  Clock,
  ListChecks,
  User,
} from "lucide-react";
import type { Doc } from "~/convex/_generated/dataModel";
import { AREAS, AREA_META, STATUS_META, type Area } from "../lib/constants";
import { ProgressSlider } from "./TaskCard";
import { CompleteButton } from "./CompleteButton";
import { StatusBadge } from "./Badges";
import { useSubtaskCounts } from "../hooks/useSubtaskCounts";
import { cn, isSuperUrgent } from "../lib/utils";

interface ListViewProps {
  tasks: Doc<"tasks">[];
  onEditTask: (task: Doc<"tasks">) => void;
  onNewTask: (area: Area) => void;
}

/**
 * Vista Lista reimaginada: tabla densa por área.
 * Cada fila: estado (icono tonal) · título + metadatos · slider de progreso · badge.
 */
export function ListView({ tasks, onEditTask, onNewTask }: ListViewProps) {
  const counts = useSubtaskCounts();

  // Agrupar por área
  const byArea = useMemo(() => {
    const map: Record<string, Doc<"tasks">[]> = {};
    for (const a of AREAS) map[a] = [];
    for (const t of tasks) {
      if (map[t.area]) map[t.area].push(t);
    }
    // Ordenar: súper urgentes ancladas arriba, luego no completadas, luego
    // por orden (sort estable: entre súper urgentes manda su order).
    for (const a of AREAS) {
      map[a].sort((x, y) => {
        const ux = Number(isSuperUrgent(x));
        const uy = Number(isSuperUrgent(y));
        if (ux !== uy) return uy - ux;
        if ((x.status === "completado") !== (y.status === "completado")) {
          return x.status === "completado" ? 1 : -1;
        }
        return x.order - y.order;
      });
    }
    return map;
  }, [tasks]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-3 px-0 sm:px-1">
      {AREAS.map((area, i) => (
        <motion.div
          key={area}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06, duration: 0.25, ease: "easeOut" }}
        >
          <AreaGroup
            area={area}
            tasks={byArea[area]}
            counts={counts}
            onEditTask={onEditTask}
            onNewTask={() => onNewTask(area)}
          />
        </motion.div>
      ))}
    </div>
  );
}

/** Grupo de un área: header plegable + filas tipo tabla. */
function AreaGroup({
  area,
  tasks,
  counts,
  onEditTask,
  onNewTask,
}: {
  area: Area;
  tasks: Doc<"tasks">[];
  counts: Record<string, { done: number; total: number }>;
  onEditTask: (t: Doc<"tasks">) => void;
  onNewTask: () => void;
}) {
  const [open, setOpen] = useState(true);
  const meta = AREA_META[area];
  const pending = tasks.filter((t) => t.status !== "completado").length;

  return (
    <div className="card overflow-hidden">
      {/* Header plegable */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-3 text-left transition-colors hover:bg-panel2 sm:px-4"
        style={{ "--tone": meta.tone } as CSSProperties}
      >
        <motion.span animate={{ rotate: open ? 0 : -90 }}>
          <ChevronDown className="h-4 w-4 text-faint" />
        </motion.span>
        <span
          className="grid h-7 w-7 place-items-center rounded-el border-el"
          style={{
            color: "var(--tone)",
            background: "color-mix(in srgb, var(--tone) 12%, transparent)",
            borderColor: "color-mix(in srgb, var(--tone) 35%, transparent)",
          }}
        >
          <meta.Icon className="h-4 w-4" />
        </span>
        <h2 className="flex-1 truncate font-display text-base font-semibold text-ink">
          {meta.label}
        </h2>
        <span className="shrink-0 rounded-full border-el border-line bg-panel2 px-2 py-0.5 text-xs font-medium text-mute">
          {pending} activas · {tasks.length} total
        </span>
      </button>

      {/* Filas */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-line">
              {tasks.length === 0 ? (
                <p className="px-4 py-5 text-center text-sm text-faint">
                  Sin tareas en esta área
                </p>
              ) : (
                tasks.map((task) => (
                  <TaskRow
                    key={task._id}
                    task={task}
                    count={counts[task._id]}
                    onClick={() => onEditTask(task)}
                  />
                ))
              )}
              <button
                onClick={onNewTask}
                className="flex w-full items-center justify-center gap-1.5 py-2.5 text-sm text-faint transition-colors hover:bg-panel2 hover:text-ink"
              >
                <Plus className="h-4 w-4" />
                Nueva tarea en {meta.label}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Fila densa de tarea. */
function TaskRow({
  task,
  count,
  onClick,
}: {
  task: Doc<"tasks">;
  count?: { done: number; total: number };
  onClick: () => void;
}) {
  const meta = STATUS_META[task.status];
  const isCompleted = task.status === "completado";
  const superUrgent = isSuperUrgent(task);

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClick}
      style={{ "--tone": meta.tone } as CSSProperties}
      title={superUrgent ? "Súper urgente: ignora los filtros, siempre primera" : undefined}
      className={cn(
        "task-accent group relative grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b border-line px-3 py-2.5 transition-colors hover:bg-panel2 sm:grid-cols-[auto_minmax(0,1fr)_180px_auto] sm:px-4",
        superUrgent && "super-urgent",
        isCompleted && "opacity-60",
      )}
    >
      {/* Borde holográfico RGB (mismo aro que las tarjetas del kanban). */}
      {superUrgent && <span aria-hidden className="su-ring z-[1]" />}

      {/* Botón rápido de completar */}
      <CompleteButton
        task={task}
        revealOnHover
        size="md"
        className="mr-0.5"
      />

      {/* Icono de estado tonal */}
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-el"
        style={{
          color: "var(--tone)",
          background: "color-mix(in srgb, var(--tone) 13%, transparent)",
        }}
        title={meta.label}
      >
        <meta.Icon className="h-4 w-4" />
      </span>

      {/* Título + metadatos */}
      <div className="min-w-0">
        <p
          className={cn(
            "truncate text-sm font-semibold text-ink",
            isCompleted && "text-mute line-through",
          )}
        >
          {task.title}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-mute">
          {count && count.total > 0 && (
            <span className="inline-flex items-center gap-1">
              <ListChecks className="h-3 w-3" />
              {count.done}/{count.total}
            </span>
          )}
          {task.estimate && task.estimate !== "por definir" && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {task.estimate}
            </span>
          )}
          {task.dueDate && task.dueDate !== "por definir" && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {task.dueDate}
            </span>
          )}
          {task.scheduledDates && (
            <span
              className="inline-flex items-center gap-1"
              style={{ color: "var(--status-programado)" }}
            >
              <Calendar className="h-3 w-3" />
              {task.scheduledDates}
            </span>
          )}
          {task.requestedBy && (
            <span className="inline-flex items-center gap-1">
              <User className="h-3 w-3" />
              {task.requestedBy}
            </span>
          )}
          {task.notes && (
            <span className="hidden max-w-[380px] truncate italic lg:inline">
              {task.notes}
            </span>
          )}
        </div>
      </div>

      {/* Slider (columna propia en desktop) */}
      {!isCompleted ? (
        <ProgressSlider
          task={task}
          className="col-span-3 sm:col-span-1 sm:w-[180px]"
        />
      ) : (
        <span className="hidden sm:block" />
      )}

      {/* Badge de estado */}
      <div className="hidden justify-self-end sm:block">
        <StatusBadge status={task.status} size="xs" />
      </div>
    </motion.div>
  );
}
