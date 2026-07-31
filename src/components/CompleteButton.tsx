import { useMutation } from "convex/react";
import toast from "react-hot-toast";
import { Check, CheckCircle2 } from "lucide-react";
import type { Doc } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import { cn } from "../lib/utils";
import { useAuth } from "../hooks/useAuth";

interface CompleteButtonProps {
  task: Doc<"tasks">;
  /** Mostrar el botón solo en hover (más limpio en cards). */
  revealOnHover?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Botón rápido para marcar/desmarcar una tarea como completada.
 * - Marca → muestra un globo "Deshacer" por si fue sin querer.
 * - Desmarca → toggle silencioso.
 */
export function CompleteButton({
  task,
  revealOnHover = false,
  size = "sm",
  className,
}: CompleteButtonProps) {
  const toggleComplete = useMutation(api.tasks.toggleComplete);
  const { token } = useAuth();
  const isCompleted = task.status === "completado";

  async function handleToggle() {
    const wasCompleted = task.status === "completado";
    try {
      await toggleComplete({ id: task._id, sessionToken: token! });
    } catch (e) {
      if (import.meta.env.DEV) console.error("[toggleComplete]", e);
      toast.error("No se pudo actualizar la tarea");
      return;
    }
    // Solo al MARCAR mostramos el globo de deshacer.
    if (!wasCompleted) {
      toast.custom(
        (t) => (
          <UndoToast
            onUndo={async () => {
              toast.dismiss(t.id);
              try {
                await toggleComplete({ id: task._id, sessionToken: token! });
                toast.success("Tarea restaurada");
              } catch (e) {
                if (import.meta.env.DEV) console.error("[toggleComplete undo]", e);
                toast.error("No se pudo deshacer");
              }
            }}
          />
        ),
        { duration: 5000, position: "top-right" },
      );
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void handleToggle();
      }}
      data-no-dnd
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      aria-label={isCompleted ? "Marcar como pendiente" : "Marcar como completada"}
      title={isCompleted ? "Desmarcar" : "Marcar completada"}
      className={cn(
        "grid shrink-0 place-items-center rounded-full border transition-all",
        size === "sm" ? "h-6 w-6" : "h-7 w-7",
        isCompleted
          ? "border-transparent bg-[var(--status-completado)] text-white"
          : "border-line bg-panel text-mute hover:border-[var(--status-completado)] hover:bg-[color-mix(in_srgb,var(--status-completado)_15%,transparent)] hover:text-[var(--status-completado)]",
        // Visibilidad: siempre visible si está completada; si no, según revealOnHover.
        !isCompleted && revealOnHover && "opacity-0 group-hover:opacity-100",
        className,
      )}
    >
      <Check
        className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"}
        strokeWidth={3}
      />
    </button>
  );
}

/** Globo de "Deshacer" consistente con el tema. */
function UndoToast({ onUndo }: { onUndo: () => void }) {
  return (
    <div
      className="flex items-center gap-3 rounded-el px-3 py-2.5 text-sm shadow-el-lg"
      style={{
        background: "var(--surface-2)",
        border: "var(--bw) solid var(--border)",
        color: "var(--text)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <CheckCircle2
        className="h-4 w-4 shrink-0"
        style={{ color: "var(--status-completado)" }}
      />
      <span className="flex-1 font-medium">Tarea completada</span>
      <button
        type="button"
        onClick={onUndo}
        className="rounded-md border px-2 py-1 text-xs font-semibold transition-colors hover:bg-panel2"
        style={{ borderColor: "var(--border)", color: "var(--text)" }}
      >
        Deshacer
      </button>
    </div>
  );
}
