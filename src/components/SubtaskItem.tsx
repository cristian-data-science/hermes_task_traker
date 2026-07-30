import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Check, Trash2 } from "lucide-react";
import type { Doc } from "~/convex/_generated/dataModel";
import { cn } from "../lib/utils";

interface SubtaskItemProps {
  subtask: Doc<"subtasks">;
  onToggle: (id: Doc<"subtasks">["_id"]) => void;
  onRemove: (id: Doc<"subtasks">["_id"]) => void;
}

/**
 * Fila de sub-tarea arrastrable (con @dnd-kit/sortable).
 * - Handle GripVertical para arrastrar y reordenar.
 * - Checkbox bien visible para marcar completada.
 * - Título tachado cuando está hecha.
 * - Botón de eliminar.
 *
 * NOTA: deliberadamente NO usa framer-motion (motion.div + layout) aquí.
 * dnd-kit gestiona el `transform`/`transition` para el reordenamiento, y
 * combinarlo con framer-motion `layout` causa un bug de render en el primer
 * mount del modal (las subtareas quedan invisibles hasta la segunda apertura).
 */
export function SubtaskItem({ subtask, onToggle, onRemove }: SubtaskItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: subtask._id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.6 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 rounded-el border-el border-line px-2 py-1.5",
        isDragging && "shadow-el-lg ring-1 ring-accent",
      )}
    >
      {/* Handle de arrastre (activator aislado: no arranca al clicar el check) */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-faint transition-colors hover:text-mute active:cursor-grabbing"
        aria-label="Arrastrar para reordenar"
        title="Arrastrar para reordenar"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Checkbox de completar (agrandado y bien visible) */}
      <button
        type="button"
        onClick={() => onToggle(subtask._id)}
        aria-pressed={subtask.done}
        aria-label={subtask.done ? "Desmarcar como hecha" : "Marcar como hecha"}
        title={subtask.done ? "Desmarcar" : "Marcar como hecha"}
        className={cn(
          "grid h-5 w-5 shrink-0 place-items-center rounded-[5px] border-2 transition-all",
          subtask.done
            ? "border-[var(--status-completado)] bg-[var(--status-completado)] text-white"
            : "border-line2 bg-transparent hover:border-[var(--status-completado)] hover:bg-[color-mix(in_srgb,var(--status-completado)_12%,transparent)]",
        )}
      >
        {subtask.done && <Check className="h-3 w-3" strokeWidth={3.5} />}
      </button>

      {/* Título */}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          subtask.done ? "text-faint line-through" : "text-ink",
        )}
      >
        {subtask.title}
      </span>

      {/* Eliminar */}
      <button
        type="button"
        onClick={() => onRemove(subtask._id)}
        className="text-faint transition-colors hover:text-danger"
        aria-label="Eliminar sub-tarea"
        title="Eliminar"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
