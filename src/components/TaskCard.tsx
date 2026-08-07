import { useEffect, useState, type CSSProperties, useRef } from "react";
import { motion } from "framer-motion";
import { useMutation } from "convex/react";
import {
  Calendar,
  Clock,
  ListChecks,
  AlertTriangle,
  CheckCircle2,
  User,
  ExternalLink,
  Circle,
  Unlink,
} from "lucide-react";
import type { Doc } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import { AreaBadge, StatusBadge } from "./Badges";
import { CompleteButton } from "./CompleteButton";
import { EXECUTOR_META } from "../lib/constants";
import { cn, statusTone, formatRelative } from "../lib/utils";
import { useAuth } from "../hooks/useAuth";

/** Slider rápido de progreso 0-100 (commit al soltar). */
export function ProgressSlider({
  task,
  className,
}: {
  task: Doc<"tasks">;
  className?: string;
}) {
  const update = useMutation(api.tasks.update);
  const { token } = useAuth();
  const [val, setVal] = useState(task.progress ?? 0);
  /**
   * true mientras el usuario está arrastrando. Bloquea la sincronización desde
   * el servidor: `task.progress` es una query reactiva de Convex y puede
   * cambiar en medio del gesto (otro dispositivo, o el recálculo automático al
   * tildar una subtarea), lo que hacía saltar el slider bajo el dedo.
   */
  const dragging = useRef(false);

  useEffect(() => {
    if (dragging.current) return;
    setVal(task.progress ?? 0);
  }, [task.progress]);

  function commit() {
    dragging.current = false;
    if (val !== (task.progress ?? 0)) {
      void update({ id: task._id, progress: val, sessionToken: token! });
    }
  }

  return (
    <div
      // data-no-dnd: los sensores custom ignoran los eventos de esta zona,
      // así arrastrar el slider no arrastra la tarjeta del kanban.
      data-no-dnd
      className={cn("flex items-center gap-2", className)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={val}
        onPointerDown={() => {
          dragging.current = true;
        }}
        onChange={(e) => setVal(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        aria-label="Progreso"
        className="pct-slider min-w-0 flex-1 touch-none"
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
  /**
   * Ubicación dentro del proyecto ("FASE 1 › Correcciones"). La pinta el
   * Kanban cuando agrupa por proyecto: el encabezado dice de qué proyecto es
   * y esto precisa de qué cuelga dentro.
   */
  subtitle?: string;
  onClick?: () => void;
  /** Modo compacto para columna Kanban. */
  variant?: "kanban" | "list";
  /**
   * Animación `layout` de framer-motion. Desactivar dentro del kanban:
   * ahí los transforms los maneja dnd-kit (sortable) y ambos chocan.
   */
  layoutAnim?: boolean;
}

/**
 * Tarjeta de tarea.
 * - variant="kanban": usada en columnas (el drag lo maneja el wrapper sortable).
 * - variant="list": usada en la vista de lista (sin drag, más info).
 */
export function TaskCard({
  task,
  subtaskCount,
  subtitle,
  onClick,
  variant = "kanban",
  layoutAnim = true,
}: TaskCardProps) {
  const isCompleted = task.status === "completado";

  return (
    <motion.div
      style={{ "--tone": statusTone(task.status) } as CSSProperties}
      layout={layoutAnim}
      // Sin animación de entrada en kanban: al cambiar de columna durante el
      // drag la tarjeta se re-monta y el fade-in provocaría parpadeo.
      initial={layoutAnim ? { opacity: 0, scale: 0.97 } : false}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 350, damping: 28 }}
      whileHover={layoutAnim ? { y: -2 } : undefined}
      onClick={onClick}
      className={cn(
        "card task-accent group relative cursor-pointer overflow-hidden p-3 transition-shadow hover:shadow-el-lg",
        isCompleted && "opacity-70",
      )}
    >
      {/* Botón rápido de completar (esquina superior derecha) */}
      <CompleteButton
        task={task}
        revealOnHover
        className="absolute right-2 top-2"
      />

      {/* Header: área + estado */}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 pl-1.5">
        <AreaBadge area={task.area} />
        {variant === "kanban" && <StatusBadge status={task.status} size="xs" />}
      </div>

      {subtitle && (
        <p
          className="mb-0.5 truncate pl-1.5 text-[10px] leading-tight text-faint"
          title={subtitle}
        >
          {subtitle}
        </p>
      )}

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
        {(() => {
          // Priorizar clickupAssignee (responsable real de ClickUp) sobre executor.
          if (task.clickupAssignee) {
            return (
              <span
                className="inline-flex items-center gap-1 font-medium text-mute"
                title={`Responsable ClickUp: ${task.clickupAssignee}`}
              >
                <User className="h-3 w-3" />
                {task.clickupAssignee}
              </span>
            );
          }
          const execMeta = EXECUTOR_META[task.executor ?? "cris"];
          const ExecIcon = execMeta.Icon;
          return (
            <span
              className={cn(
                "inline-flex items-center gap-1 font-medium",
                execMeta.color,
              )}
              title={`Ejecutor: ${execMeta.label}`}
            >
              <ExecIcon className="h-3 w-3" />
              {execMeta.label}
            </span>
          );
        })()}

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

        {/* Badge de origen: desvinculada / ClickUp (con link) / Local */}
        {task.clickupDetached ? (
          <span
            className="inline-flex items-center gap-1 text-faint"
            title="Desvinculada de ClickUp: ya no se sincroniza, y eliminarla acá no la borra allá."
          >
            <Unlink className="h-3 w-3" />
            Desvinculada
          </span>
        ) : task.clickupUrl ? (
          <a
            href={task.clickupUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-no-dnd
            onClick={(e) => e.stopPropagation()}
            title={
              task.clickupSyncError
                ? `ClickUp: error de sync — ${task.clickupSyncError}`
                : "Ver en ClickUp"
            }
            className={cn(
              "inline-flex items-center gap-1",
              task.clickupSyncError
                ? "text-danger"
                : "text-mute hover:text-accent",
            )}
          >
            {task.clickupSyncError ? (
              <AlertTriangle className="h-3 w-3" />
            ) : (
              <ExternalLink className="h-3 w-3" />
            )}
            ClickUp
          </a>
        ) : (
          <span
            className="inline-flex items-center gap-1 text-faint"
            title="Tarea local (solo en Convex, no sincronizada con ClickUp)"
          >
            <Circle className="h-2.5 w-2.5 fill-current" />
            Local
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
