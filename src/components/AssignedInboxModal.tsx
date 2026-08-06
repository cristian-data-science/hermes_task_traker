import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  Check,
  Folder,
  Inbox,
  List as ListIcon,
  Loader2,
  Plus,
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

/** Un nodo del árbol agrupado de la bandeja. */
interface InboxNode {
  /** Clave única y estable: prefijo de tipo + id de ClickUp. */
  key: string;
  name: string;
  kind: "folder" | "list" | "task";
  /** Tareas sin trackear que cuelgan directo de este nodo. */
  tasks: AssignedUntrackedTask[];
  children: InboxNode[];
  /** Total de tareas en todo el subárbol (para el contador del grupo). */
  count: number;
}

/** Todas las tareas de una rama, incluidas las de sus descendientes. */
function collectTasks(node: InboxNode): AssignedUntrackedTask[] {
  return [...node.tasks, ...node.children.flatMap(collectTasks)];
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
  /** key del grupo con un alta masiva en curso. */
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);

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
            label: [
              task.listName,
              ...task.ancestors.map((a) => a.name),
              task.name,
            ].join(" · "),
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
        [t.name, t.folderName, t.listName, ...t.ancestors.map((a) => a.name)]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
    : tasks;
  const pending = visible.filter((t) => !added.has(t.id));

  /**
   * Agrupa las tareas sueltas en el árbol real de ClickUp:
   * folder → list → ancestros → tarea. Sin esto son 40 filas planas y no se
   * ve a qué fase o proyecto pertenece cada una.
   */
  const groups = useMemo(() => {
    const roots: InboxNode[] = [];
    const ensure = (
      siblings: InboxNode[],
      key: string,
      name: string,
      kind: InboxNode["kind"],
    ): InboxNode => {
      let node = siblings.find((n) => n.key === key);
      if (!node) {
        node = { key, name, kind, tasks: [], children: [], count: 0 };
        siblings.push(node);
      }
      return node;
    };

    for (const task of pending) {
      const folder = ensure(
        roots,
        `f:${task.folderId}`,
        task.folderName,
        "folder",
      );
      let node = ensure(
        folder.children,
        `l:${task.listId}`,
        task.listName,
        "list",
      );
      for (const anc of task.ancestors) {
        node = ensure(node.children, `t:${anc.id}`, anc.name, "task");
      }
      node.tasks.push(task);
    }

    // Contador acumulado por rama, para el "N sin trackear" de cada grupo.
    const countOf = (n: InboxNode): number => {
      n.count = n.tasks.length + n.children.reduce((a, c) => a + countOf(c), 0);
      return n.count;
    };
    roots.forEach(countOf);
    return roots;
  }, [pending]);

  /** Agrega de una vez todas las tareas de una rama. */
  async function handleAddMany(node: InboxNode) {
    if (!token || bulkBusy) return;
    const batch = collectTasks(node).filter(
      (t) => !added.has(t.id) && !adding.has(t.id),
    );
    if (batch.length === 0) return;
    setBulkBusy(node.key);
    try {
      const result = await applySubs({
        sessionToken: token,
        add: batch.map((t) => ({
          nodeType: "task" as const,
          id: t.id,
          label: [
            t.listName,
            ...t.ancestors.map((a) => a.name),
            t.name,
          ].join(" · "),
        })),
        remove: [],
      });
      const failedIds = new Set((result.failed ?? []).map((f) => f.id));
      const ok = batch.filter((t) => !failedIds.has(t.id));
      if (ok.length > 0) {
        setAdded((prev) => {
          const next = new Set(prev);
          ok.forEach((t) => next.add(t.id));
          return next;
        });
        toast.success(
          `${ok.length} tarea${ok.length !== 1 ? "s" : ""} agregada${ok.length !== 1 ? "s" : ""} al tablero`,
        );
      }
      if (failedIds.size > 0) {
        toast.error(
          `${failedIds.size} no se pudo${failedIds.size !== 1 ? "ieron" : ""} traer de ClickUp`,
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudieron agregar las tareas",
      );
    } finally {
      setBulkBusy(null);
    }
  }

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
                <div className="space-y-2">
                  {groups.map((group) => (
                    <InboxGroup
                      key={group.key}
                      node={group}
                      depth={0}
                      adding={adding}
                      onAdd={handleAdd}
                      onAddMany={handleAddMany}
                      bulkBusy={bulkBusy}
                    />
                  ))}
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

/**
 * Un grupo del árbol de la bandeja (folder / list / tarea contenedora), con
 * sus tareas sin trackear y sus subgrupos. Recursivo: refleja la jerarquía
 * real de ClickUp a cualquier profundidad.
 *
 * Arranca abierto: el objetivo de la bandeja es VER de una qué falta, no ir
 * abriendo carpetas. El estado de plegado es local a cada grupo porque nada
 * externo necesita leerlo.
 */
function InboxGroup({
  node,
  depth,
  adding,
  onAdd,
  onAddMany,
  bulkBusy,
}: {
  node: InboxNode;
  depth: number;
  adding: Set<string>;
  onAdd: (task: AssignedUntrackedTask) => void;
  onAddMany: (node: InboxNode) => void;
  bulkBusy: string | null;
}) {
  const [open, setOpen] = useState(true);
  const Icon =
    node.kind === "folder" ? Folder : node.kind === "list" ? ListIcon : Plus;
  const busyHere = bulkBusy === node.key;

  return (
    <div
      className={cn(
        depth === 0 && "overflow-hidden rounded-el border-el border-line",
      )}
    >
      {/* Cabecera del grupo */}
      <div
        className={cn(
          "flex items-center gap-2 px-2.5 py-1.5",
          depth === 0 ? "bg-panel2" : "",
        )}
        style={depth > 0 ? { paddingLeft: `${depth * 12}px` } : undefined}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="grid h-4 w-4 shrink-0 place-items-center rounded text-mute hover:text-ink"
          title={open ? "Contraer" : "Expandir"}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        {node.kind !== "task" && (
          <Icon
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              node.kind === "folder" ? "text-amber-500" : "text-indigo-500",
            )}
          />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            node.kind === "folder"
              ? "text-sm font-semibold text-ink"
              : node.kind === "list"
                ? "text-sm font-medium text-ink"
                : "text-[13px] text-ink",
          )}
          title={node.name}
        >
          {node.name}
        </span>
        <span className="shrink-0 text-[10px] text-faint">
          {node.count} sin trackear
        </span>
        {node.count > 1 && (
          <button
            type="button"
            onClick={() => onAddMany(node)}
            disabled={!!bulkBusy}
            className="shrink-0 rounded-el px-1.5 py-0.5 text-[10px] font-medium text-accent hover:bg-panel disabled:opacity-50"
            title={`Agregar las ${node.count} tareas de esta rama`}
          >
            {busyHere ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              `+ agregar las ${node.count}`
            )}
          </button>
        )}
      </div>

      {open && (
        <div className={cn(depth === 0 ? "p-1.5 pt-0" : "")}>
          {/* Subgrupos primero: mantienen la forma del árbol de ClickUp. */}
          {node.children.map((child) => (
            <InboxGroup
              key={child.key}
              node={child}
              depth={depth + 1}
              adding={adding}
              onAdd={onAdd}
              onAddMany={onAddMany}
              bulkBusy={bulkBusy}
            />
          ))}

          {/* Tareas que cuelgan directo de este nodo. */}
          {node.tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-panel2"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[13px] font-medium text-ink"
                  title={task.name}
                >
                  {task.name}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-mute">
                  <span className="rounded-full bg-panel2 px-1.5 py-0.5">
                    {task.status}
                  </span>
                  {task.dueDate && <span>vence {task.dueDate}</span>}
                </div>
              </div>
              <button
                onClick={() => onAdd(task)}
                disabled={adding.has(task.id) || !!bulkBusy}
                className="btn-primary shrink-0 px-2 py-1 text-[11px] disabled:opacity-60"
              >
                {adding.has(task.id) ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                Agregar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
