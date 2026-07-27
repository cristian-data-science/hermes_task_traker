import { motion } from "framer-motion";
import { Calendar, Clock, GitBranch, ListChecks, AlertTriangle } from "lucide-react";
import type { Doc } from "~/convex/_generated/dataModel";
import { AreaBadge, StatusBadge } from "./Badges";
import { cn, statusAccent, formatRelative } from "../lib/utils";

interface TaskCardProps {
  task: Doc<"tasks">;
  subtaskCount?: { done: number; total: number };
  onClick?: () => void;
  /** Modo compacto para columna Kanban. */
  variant?: "kanban" | "list";
  draggableProps?: {
    listeners: Record<string, unknown>;
    attributes: Record<string, unknown>;
    setNodeRef: (el: HTMLElement | null) => void;
    style?: React.CSSProperties;
    isDragging?: boolean;
  };
}

/**
 * Tarjeta de tarea.
 * - variant="kanban": usada en columnas (con drag).
 * - variant="list": usada en la vista de lista (sin drag, más info).
 */
export function TaskCard({
  task,
  subtaskCount,
  onClick,
  variant = "kanban",
  draggableProps,
}: TaskCardProps) {
  const isCompleted = task.status === "completado";
  const isUrgente = task.status === "urgente";

  const card = (
    <motion.div
      ref={draggableProps?.setNodeRef}
      style={draggableProps?.style}
      {...(draggableProps?.listeners ?? {})}
      {...(draggableProps?.attributes ?? {})}
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{
        opacity: draggableProps?.isDragging ? 0.5 : 1,
        scale: 1,
      }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 350, damping: 28 }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      className={cn(
        "group relative cursor-pointer overflow-hidden rounded-xl border bg-white p-3 shadow-sm transition-shadow",
        "hover:shadow-md dark:bg-slate-900",
        isCompleted
          ? "border-slate-200 opacity-75 dark:border-slate-800 dark:opacity-80"
          : isUrgente
            ? "border-red-200 dark:border-red-900/60"
            : "border-slate-200 dark:border-slate-800",
        // Barra de acento a la izquierda según estado
        "before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-['']",
        statusAccent(task.status),
      )}
    >
      {/* Header: área + título */}
      <div className="mb-1.5 pl-1.5">
        <AreaBadge area={task.area} />
      </div>

      <h3
        className={cn(
          "pl-1.5 text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100",
          isCompleted && "text-slate-500 line-through dark:text-slate-500",
        )}
      >
        {task.title}
      </h3>

      {/* Notas (solo en variante lista o si hay notas cortas) */}
      {variant === "list" && task.notes && (
        <p className="mt-1.5 line-clamp-2 pl-1.5 text-xs text-slate-500 dark:text-slate-400">
          {task.notes}
        </p>
      )}

      {/* Footer: metadatos */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-1.5 text-[11px] text-slate-500 dark:text-slate-400">
        {variant === "kanban" && <StatusBadge status={task.status} size="xs" />}

        {subtaskCount && subtaskCount.total > 0 && (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              subtaskCount.done === subtaskCount.total &&
                "text-emerald-600 dark:text-emerald-400",
            )}
          >
            <ListChecks className="h-3 w-3" />
            {subtaskCount.done}/{subtaskCount.total}
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

        {task.progress !== undefined && task.progress > 0 && task.progress < 100 && (
          <span className="inline-flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            {task.progress}%
          </span>
        )}

        {task.scheduledDates && (
          <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
            <Calendar className="h-3 w-3" />
            {task.scheduledDates}
          </span>
        )}

        {task.standbyFrom && (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            desde {task.standbyFrom}
          </span>
        )}
      </div>

      {/* Footer de completado */}
      {isCompleted && task.completedAt && (
        <div className="mt-1.5 pl-1.5 text-[10px] text-emerald-600 dark:text-emerald-500">
          completado {formatRelative(task.completedAt)}
        </div>
      )}
    </motion.div>
  );

  return card;
}
