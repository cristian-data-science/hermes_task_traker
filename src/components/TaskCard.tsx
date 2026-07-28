import { useEffect, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { useMutation } from "convex/react";
import {
  Calendar,
  Clock,
  ListChecks,
  AlertTriangle,
  CheckCircle2,
  User,
} from "lucide-react";
import type { Doc } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import { AreaBadge, StatusBadge } from "./Badges";
import { cn, statusTone, formatRelative } from "../lib/utils";

/** Slider rápido de progreso 0-100 (commit al soltar). */
export function ProgressSlider({
  task,
  className,
}: {
  task: Doc<"tasks">;
  className?: string;
}) {
  const update = useMutation(api.tasks.update);
  const [val, setVal] = useState(task.progress ?? 0);

  useEffect(() => {
    setVal(task.progress ?? 0);
  }, [task.progress]);

  function commit() {
    if (val !== (task.progress ?? 0)) {
      void update({ id: task._id, progress: val });
    }
  }

  return (
    <div
      className={cn("flex items-center gap-2", className)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={val}
        onChange={(e) => setVal(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        aria-label="Progreso"
        className="pct-slider min-w-0 flex-1"
        style={{
          background: `linear-gradient(to right, var(--tone, var(--accent)) ${val}%, color-mix(in srgb, var(--border) 55%, transparent) ${val}%)`,
        }}
      />
      <span className="w-9 shrink-0 text-right text-[10px] font-bold tabular-nums text-mute">
        {val}%
      </span>
    </div>
  );
}

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

  return (
    <motion.div
      ref={draggableProps?.setNodeRef}
      style={
        {
          ...draggableProps?.style,
          "--tone": statusTone(task.status),
        } as CSSProperties
      }
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
        "card task-accent group relative cursor-pointer overflow-hidden p-3 transition-shadow hover:shadow-el-lg",
        isCompleted && "opacity-70",
      )}
    >
      {/* Header: área + estado */}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 pl-1.5">
        <AreaBadge area={task.area} />
        {variant === "kanban" && <StatusBadge status={task.status} size="xs" />}
      </div>

      <h3
        className={cn(
          "pl-1.5 text-sm font-semibold leading-snug text-ink",
          isCompleted && "text-mute line-through",
        )}
      >
        {task.title}
      </h3>

      {/* Notas (solo en variante lista) */}
      {variant === "list" && task.notes && (
        <p className="mt-1.5 line-clamp-2 pl-1.5 text-xs text-mute">
          {task.notes}
        </p>
      )}

      {/* Footer: metadatos */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-1.5 text-[11px] text-mute">
        {subtaskCount && subtaskCount.total > 0 && (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              subtaskCount.done === subtaskCount.total && "text-accent",
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

        {task.scheduledDates && (
          <span
            className="inline-flex items-center gap-1"
            style={{ color: "var(--status-programado)" }}
          >
            <Calendar className="h-3 w-3" />
            {task.scheduledDates}
          </span>
        )}

        {task.standbyFrom && (
          <span
            className="inline-flex items-center gap-1"
            style={{ color: "var(--status-pendiente)" }}
          >
            <AlertTriangle className="h-3 w-3" />
            desde {task.standbyFrom}
          </span>
        )}

        {variant === "list" && task.requestedBy && (
          <span className="inline-flex items-center gap-1">
            <User className="h-3 w-3" />
            {task.requestedBy}
          </span>
        )}
      </div>

      {/* Slider rápido de progreso 0-100 */}
      {!isCompleted && <ProgressSlider task={task} className="ml-1.5 mt-2.5" />}

      {/* Footer de completado */}
      {isCompleted && task.completedAt && (
        <div
          className="mt-1.5 flex items-center gap-1 pl-1.5 text-[10px]"
          style={{ color: "var(--status-completado)" }}
        >
          <CheckCircle2 className="h-3 w-3" />
          completado {formatRelative(task.completedAt)}
        </div>
      )}
    </motion.div>
  );
}
