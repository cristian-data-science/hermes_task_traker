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
  Zap,
} from "lucide-react";
import type { Doc } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import { AreaBadge, StatusBadge } from "./Badges";
import { CompleteButton } from "./CompleteButton";
import { CatchupPinButton } from "./CatchupPinButton";
import { EXECUTOR_META, AGENT_STATE_META, type AgentState } from "../lib/constants";
import { cn, statusTone, formatRelative, formatAgo, isSuperUrgent, AGENT_UI_ENABLED } from "../lib/utils";
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
  const superUrgent = isSuperUrgent(task);

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
      title={superUrgent ? "Súper urgente: ignora los filtros, siempre primera" : undefined}
      className={cn(
        "card task-accent group relative cursor-pointer overflow-hidden p-3 transition-shadow hover:shadow-el-lg",
        superUrgent && "super-urgent",
        isCompleted && "opacity-70",
      )}
    >
      {/* Borde holográfico RGB (estilo teclado gamer). Span dedicado para no
          pisar el ::before de task-accent; el aro se dibuja con máscara y
          cicla colores por hue-rotate. Ver .su-ring en index.css. */}
      {superUrgent && <span aria-hidden className="su-ring" />}

      {/* Botón rápido de completar (esquina superior derecha) */}
      <CompleteButton
        task={task}
        revealOnHover
        className="absolute right-2 top-2"
      />

      {/* Pin "llevar al catch-up", a la izquierda del completar */}
      <CatchupPinButton
        task={task}
        revealOnHover
        className="absolute right-9 top-2 z-[1]"
      />

      {/* Header: súper urgente + área + estado */}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 pl-1.5">
        {superUrgent && (
          <span className="su-tag" title="Súper urgente: ignora los filtros, siempre primera">
            <Zap className="h-2.5 w-2.5" />
            Súper urgente
          </span>
        )}
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
        {/* Chip del ciclo de delegación (solo web): el estado del agente es la
            fuente de verdad mientras la tarea esté delegada a ZCode. */}
        {AGENT_UI_ENABLED &&
          task.executor === "zcode" &&
          task.agentState &&
          (() => {
            const st = AGENT_STATE_META[task.agentState as AgentState];
            if (!st) return null;
            return (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border-el px-1.5 py-0.5 text-[10px] font-semibold",
                  st.pulse && "animate-pulse",
                )}
                style={{
                  color: st.tone,
                  borderColor: `color-mix(in srgb, ${st.tone} 45%, transparent)`,
                  background: `color-mix(in srgb, ${st.tone} 10%, transparent)`,
                }}
                title={`Agente: ${st.label}${
                  task.workspacePath ? ` · ${task.workspacePath}` : ""
                }`}
              >
                <st.Icon className="h-3 w-3" />
                {st.label}
              </span>
            );
          })()}
        {/* Última acción del agente en vivo (solo web): el paso reportado o
            la actividad detectada del transcript, una línea, con antigüedad.
            Con plan declarado: "Paso N de M · <acción>". */}
        {AGENT_UI_ENABLED &&
          task.executor === "zcode" &&
          task.agentLastStep &&
          ["despachada", "trabajando", "pregunta"].includes(
            task.agentState ?? "",
          ) && (
            <span
              className="inline-flex w-full min-w-0 items-center gap-1 text-[10px] text-faint"
              title={task.agentLastStep}
            >
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current" />
              {task.agentPlanTotal ? (
                <span className="shrink-0 font-semibold">
                  Paso {task.agentStepIndex ?? "?"}/{task.agentPlanTotal}:
                </span>
              ) : null}
              <span className="truncate">{task.agentLastStep}</span>
              {task.agentLastStepAt && (
                <span className="shrink-0">· {formatAgo(task.agentLastStepAt)}</span>
              )}
            </span>
          )}
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
        ) : task.clickupSyncError ? (
          // Creación en ClickUp que falló (sin URL todavía): sin esta rama
          // el error era invisible y la tarea parecía "Local" sin más.
          <span
            className="inline-flex items-center gap-1 text-danger"
            title={`No se pudo crear en ClickUp — ${task.clickupSyncError}`}
          >
            <AlertTriangle className="h-3 w-3" />
            Sync fallida
          </span>
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
