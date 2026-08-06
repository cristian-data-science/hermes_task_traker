import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  Check,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { api } from "~/convex/_generated/api";
import type { AssignedUntrackedTask } from "~/convex/clickup";
import { useAuth } from "../hooks/useAuth";
import { cn } from "../lib/utils";

interface AssignedInboxModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Bandeja de tareas de ClickUp asignadas a Cris que todavía NO están en el
 * Kanban, con su jerarquía y un botón para traerlas de a una.
 *
 * Solo aparecen HOJAS (el backend filtra los contenedores): traer una fase o
 * un proyecto entero al tablero no es una unidad de trabajo.
 *
 * "Agregar" usa applySubscriptions, que en una sola operación importa la tarea
 * Y deja la suscripción persistida. Por eso, al volver a la vista de
 * suscripciones, la tarea ya aparece tildada: el check sale de la unión de
 * suscripciones + tareas importadas.
 */
export function AssignedInboxModal({ open, onClose }: AssignedInboxModalProps) {
  const { token } = useAuth();
  const listAssigned = useAction(api.clickup.listAssignedUntracked);
  const applySubs = useAction(api.clickup.applySubscriptions);

  const [tasks, setTasks] = useState<AssignedUntrackedTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  /** ids en proceso de alta. */
  const [adding, setAdding] = useState<Set<string>>(new Set());
  /** ids ya agregadas en esta sesión del modal (feedback inmediato). */
  const [added, setAdded] = useState<Set<string>>(new Set());

  const [scanned, setScanned] = useState(0);

  const load = useCallback(
    async () => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const result = await listAssigned({ sessionToken: token });
        setTasks(result.tasks);
        setScanned(result.scanned);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "No se pudieron cargar las tareas asignadas",
        );
      } finally {
        setLoading(false);
      }
    },
    [token, listAssigned],
  );

  // Cargar al abrir (una vez por apertura).
  const loadedForOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      loadedForOpenRef.current = false;
      return;
    }
    if (loadedForOpenRef.current) return;
    loadedForOpenRef.current = true;
    setAdded(new Set());
    void load();
  }, [open, load]);

  async function handleAdd(task: AssignedUntrackedTask) {
    if (!token || adding.has(task.id) || added.has(task.id)) return;
    setAdding((prev) => new Set(prev).add(task.id));
    try {
      // Importa la tarea Y persiste la suscripción en una sola operación.
      const result = await applySubs({
        sessionToken: token,
        add: [
          {
            nodeType: "task" as const,
            id: task.id,
            label: [task.listName, ...task.ancestors, task.name].join(" · "),
          },
        ],
        remove: [],
      });
      // No dar por buena la operación sin mirar el resultado: la suscripción
      // se persiste antes de traer el detalle de ClickUp, así que puede quedar
      // suscripta SIN llegar al tablero. Antes eso se mostraba como éxito.
      const failure = result.failed?.[0];
      if (failure) {
        toast.error(`No se pudo traer "${task.name}": ${failure.error}`);
        return;
      }
      const landed = result.tasksImported + result.tasksRestored;
      if (landed === 0 && result.tasksSkipped === 0) {
        toast.error(`"${task.name}" no se pudo agregar al tablero`);
        return;
      }
      setAdded((prev) => new Set(prev).add(task.id));
      toast.success(
        landed > 0
          ? `"${task.name}" agregada al tablero`
          : `"${task.name}" ya estaba en el tablero`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo agregar la tarea",
      );
    } finally {
      setAdding((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  }

  const q = search.trim().toLowerCase();
  const visible = q
    ? tasks.filter((t) =>
        [t.name, t.folderName, t.listName, ...t.ancestors]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
    : tasks;
  const pending = visible.filter((t) => !added.has(t.id));

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 48, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 340, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border-el border-line bg-panel shadow-el-lg sm:max-h-[92vh] sm:rounded-el-lg"
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
              <div className="flex min-w-0 items-center gap-2.5">
                <Inbox className="h-5 w-5 shrink-0 text-accent" />
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-semibold text-ink">
                    Asignadas a mí sin trackear
                  </h2>
                  <p className="truncate text-[11px] text-mute">
                    Tareas de ClickUp asignadas a vos que no están en el tablero
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => void load()}
                  disabled={loading}
                  title="Volver a buscar en ClickUp"
                  className="rounded-el p-1.5 text-faint transition-colors hover:bg-panel2 hover:text-ink disabled:opacity-50"
                >
                  <RefreshCw
                    className={cn("h-4 w-4", loading && "animate-spin")}
                  />
                </button>
                <button
                  onClick={onClose}
                  className="rounded-el p-1.5 text-faint transition-colors hover:bg-panel2 hover:text-ink"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
              {!loading && tasks.length > 0 && (
                <div className="relative mb-3">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filtrar por nombre, proyecto o lista…"
                    className="input pl-9"
                  />
                </div>
              )}

              {loading ? (
                <div className="flex flex-col items-center justify-center py-16 text-mute">
                  <Loader2 className="mb-3 h-7 w-7 animate-spin text-accent" />
                  <p className="text-sm">Buscando en ClickUp…</p>
                </div>
              ) : error ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-danger">{error}</p>
                  <button
                    onClick={() => void load()}
                    className="mt-3 text-xs text-accent hover:underline"
                  >
                    Reintentar
                  </button>
                </div>
              ) : pending.length === 0 ? (
                <div className="py-16 text-center text-mute">
                  <Check className="mx-auto mb-2 h-7 w-7 text-accent" />
                  <p className="text-sm">
                    {tasks.length === 0
                      ? "No hay tareas asignadas a vos fuera del tablero."
                      : q
                        ? "Sin resultados para el filtro."
                        : "Agregaste todo lo que había."}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {pending.map((task) => {
                    const busy = adding.has(task.id);
                    return (
                      <div
                        key={task.id}
                        className="flex items-start gap-3 rounded-el border-el border-line bg-panel2 px-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          {/* Jerarquía: dónde vive la tarea en ClickUp */}
                          <div className="mb-1 flex flex-wrap items-center gap-x-0.5 text-[10px] leading-tight text-faint">
                            {[task.folderName, task.listName, ...task.ancestors]
                              .filter(
                                (s, i, arr) =>
                                  !!s && (i === 0 || s !== arr[i - 1]),
                              )
                              .map((part, i) => (
                                <span
                                  key={`${part}-${i}`}
                                  className="flex items-center"
                                >
                                  {i > 0 && (
                                    <ChevronRight className="h-2.5 w-2.5 shrink-0" />
                                  )}
                                  <span>{part}</span>
                                </span>
                              ))}
                          </div>
                          <p
                            className="truncate text-sm font-medium text-ink"
                            title={task.name}
                          >
                            {task.name}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-mute">
                            <span className="rounded-full bg-panel px-1.5 py-0.5">
                              {task.status}
                            </span>
                            {task.dueDate && <span>vence {task.dueDate}</span>}
                            {task.ancestors.length === 0 && (
                              <span className="text-faint">
                                tarea suelta en la lista
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => void handleAdd(task)}
                          disabled={busy}
                          className="btn-primary shrink-0 px-2.5 py-1.5 text-xs disabled:opacity-60"
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          Agregar
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-panel px-4 py-3 sm:px-5">
              <span className="text-xs text-mute">
                {loading
                  ? "Buscando…"
                  : `${pending.length} sin trackear · ${scanned} tareas revisadas${
                      added.size > 0
                        ? ` · ${added.size} agregada${added.size !== 1 ? "s" : ""}`
                        : ""
                    }`}
              </span>
              <button onClick={onClose} className="btn px-3 py-1.5 text-sm">
                Cerrar
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
