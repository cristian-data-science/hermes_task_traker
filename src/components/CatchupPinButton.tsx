/**
 * Pin "llevar al catch-up".
 *
 * ===== POR QUÉ EXISTE =====
 * El martes a las 9 nadie se acuerda de por qué el jueves anterior algo se
 * trabó. Este botón captura ese contexto en el momento en que ocurre, con una
 * nota de una línea, y lo deposita en el bloque "Temas para conversar" de la
 * vista Catch-up.
 *
 * No es un estado de la tarea ni viaja a ClickUp: es una anotación privada
 * para tu reunión. Se limpia sola al cerrar la semana.
 */

import { useState } from "react";
import { useMutation } from "convex/react";
import { Pin, PinOff, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "~/convex/_generated/api";
import type { Doc } from "~/convex/_generated/dataModel";
import { useAuth } from "../hooks/useAuth";
import { cn } from "../lib/utils";

interface CatchupPinButtonProps {
  task: Doc<"tasks">;
  /** Oculto hasta el hover de la tarjeta (como el botón de completar). */
  revealOnHover?: boolean;
  className?: string;
}

export function CatchupPinButton({
  task,
  revealOnHover = false,
  className,
}: CatchupPinButtonProps) {
  const { token } = useAuth();
  const toggle = useMutation(api.tasks.toggleCatchupFlag);
  const [busy, setBusy] = useState(false);
  const flagged = !!task.catchupFlag;

  async function onClick(e: React.MouseEvent) {
    // La tarjeta entera es clickeable (abre el modal): sin esto, marcar el pin
    // abriría también la tarea.
    e.stopPropagation();
    if (!token || busy) return;
    setBusy(true);
    try {
      await toggle({ sessionToken: token, id: task._id, flagged: !flagged });
      toast.success(
        flagged ? "Quitado del catch-up" : "Se conversará en el catch-up",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo marcar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={(e) => void onClick(e)}
      title={flagged ? "Quitar del catch-up" : "Llevar al catch-up"}
      aria-label={flagged ? "Quitar del catch-up" : "Llevar al catch-up"}
      aria-pressed={flagged}
      className={cn(
        "grid h-6 w-6 place-items-center rounded-full transition-all",
        flagged
          ? "bg-accent/15 text-accent"
          : "text-faint hover:bg-panel2 hover:text-accent",
        // Marcada, el pin se ve SIEMPRE: si desapareciera con el mouse, el
        // tablero no te avisaría de nada al mirarlo de reojo.
        revealOnHover && !flagged && "opacity-0 group-hover:opacity-100",
        className,
      )}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : flagged ? (
        <Pin className="h-3.5 w-3.5 fill-current" />
      ) : (
        <PinOff className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

/**
 * Bloque del pin dentro del modal de tarea: además de marcar, permite escribir
 * la nota de UNA línea que explica qué querés conversar.
 *
 * La nota es lo que hace útil al pin. Una tarea marcada sin contexto te obliga
 * a reconstruir el martes por qué la marcaste el jueves — exactamente el
 * problema que esto viene a resolver.
 */
export function CatchupNoteField({ task }: { task: Doc<"tasks"> }) {
  const { token } = useAuth();
  const toggle = useMutation(api.tasks.toggleCatchupFlag);
  const flagged = !!task.catchupFlag;
  const [note, setNote] = useState(task.catchupNote ?? "");

  async function persist(nextFlag: boolean, nextNote: string) {
    if (!token) return;
    try {
      await toggle({
        sessionToken: token,
        id: task._id,
        flagged: nextFlag,
        note: nextNote.trim() || undefined,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    }
  }

  return (
    <div
      className={cn(
        "mb-4 rounded-el border-el p-3 transition-colors",
        flagged ? "border-accent/50 bg-accent/5" : "border-line bg-panel2/40",
      )}
    >
      <button
        type="button"
        onClick={() => void persist(!flagged, note)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-full",
            flagged ? "bg-accent text-acfg" : "bg-panel2 text-faint",
          )}
        >
          <Pin className={cn("h-3.5 w-3.5", flagged && "fill-current")} />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-semibold text-ink">
            Llevar al catch-up
          </span>
          <span className="block text-[11px] text-faint">
            Aparece en "Temas para conversar". Se limpia al cerrar la semana.
          </span>
        </span>
      </button>

      {flagged && (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          // Se guarda al salir del campo y no en cada tecla: escribir una nota
          // no debería disparar una escritura por carácter.
          onBlur={() => void persist(true, note)}
          placeholder="¿Qué querés conversar de esta tarea?"
          className="input mt-2 text-sm"
        />
      )}
    </div>
  );
}
