import { useEffect, useRef, useState, useCallback } from "react";
import { useAction } from "convex/react";
import {
  ChevronRight,
  ChevronDown,
  Loader2,
  Plus,
  Check,
  CornerDownRight,
} from "lucide-react";
import toast from "react-hot-toast";
import { api } from "~/convex/_generated/api";
import { useAuth } from "../hooks/useAuth";
import { cn } from "../lib/utils";

interface ClickUpTreeNavigatorProps {
  /** List de ClickUp cuyas raíces se van a navegar. */
  listId: string;
  /** parentId actualmente elegido (para marcar el nodo activo). */
  selectedParentId: string | undefined;
  /** Callback al elegir un nodo. Devuelve el parentId del nodo elegido. */
  onSelect: (parentId: string) => void;
  /**
   * Ruta a auto-expandir al montar, de la raíz hacia abajo (ids de ClickUp).
   * Se usa al REABRIR una tarea: el árbol se abre solo por esa rama hasta el
   * destino guardado, en vez de mostrar únicamente las raíces.
   */
  expandPath?: string[];
}

type TreeNode = {
  id: string;
  name: string;
  status: string;
};

/**
 * Navegador de árbol plegable para elegir dónde cae una tarea en ClickUp.
 *
 * Carga las raíces (nivel 0) de la list. Cada nodo es plegable: al expandir,
 * trae sus hijas directas (listTaskChildren) on-demand. El usuario clickea
 * "Anclar aquí" en el nodo exacto donde quiere que caiga la tarea.
 *
 * Botón "+ Crear raíz" al pie: crea una nueva tarea raíz en ClickUp
 * (createRootTask) y la ancla automáticamente.
 */
export function ClickUpTreeNavigator({
  listId,
  selectedParentId,
  onSelect,
  expandPath,
}: ClickUpTreeNavigatorProps) {
  const { token } = useAuth();
  const listProjectRoots = useAction(api.clickup.listProjectRoots);
  const listTaskChildren = useAction(api.clickup.listTaskChildren);
  const createRootTask = useAction(api.clickup.createRootTask);

  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [loadingRoots, setLoadingRoots] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newRootName, setNewRootName] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  // Cargar raíces al montar o cambiar de list.
  const loadRoots = useCallback(async () => {
    if (!token || !listId) return;
    setLoadingRoots(true);
    try {
      const result = await listProjectRoots({ sessionToken: token, listId });
      setRoots(result.roots);
    } catch (err) {
      toast.error("No se pudieron cargar las tareas de ClickUp");
    } finally {
      setLoadingRoots(false);
    }
  }, [token, listId, listProjectRoots]);

  useEffect(() => {
    void loadRoots();
  }, [loadRoots]);

  async function handleCreateRoot() {
    const name = newRootName.trim();
    if (!token || !name) return;
    setCreating(true);
    try {
      const result = await createRootTask({
        sessionToken: token,
        listId,
        name,
      });
      // Añadir la nueva raíz al árbol y anclarla.
      setRoots((r) => [
        ...r,
        { id: result.id, name: result.name, status: "to do" },
      ]);
      onSelect(result.id);
      setNewRootName("");
      setShowCreate(false);
      toast.success(`Raíz "${result.name}" creada en ClickUp`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo crear la raíz",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="rounded-el border-el border-line bg-panel p-2">
      {loadingRoots ? (
        <div className="flex items-center gap-1.5 px-2 py-2 text-xs text-mute">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Cargando tareas de ClickUp…
        </div>
      ) : roots.length === 0 ? (
        <p className="px-2 py-2 text-[11px] text-mute">
          No hay tareas-raíz en esta list.
        </p>
      ) : (
        <div className="space-y-0.5">
          <p className="px-1 pb-1 text-[10px] leading-snug text-faint">
            Elegí dónde cae la tarea. Clic en un nombre = la tarea queda como su
            <strong> hija</strong>. Clic en <ChevronRight className="inline h-2.5 w-2.5" /> para ver subtareas y bajar de nivel.
          </p>
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {/* Opción "plano" = sin parent (nivel 0, suelta) */}
          <button
            type="button"
            onClick={() => onSelect("")}
            className={cn(
              "flex w-full items-center gap-1.5 rounded border-l-2 px-2 py-1 text-left text-xs",
              // Sin parent (undefined o "") = tarea plana en esta list.
              !selectedParentId
                ? "border-accent bg-accent/20 font-bold text-accent ring-1 ring-accent/60"
                : "border-transparent text-mute hover:bg-panel2",
            )}
          >
            <CornerDownRight className="h-3 w-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              plano (nivel 0, sin anidar)
            </span>
            {!selectedParentId && (
              <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-acfg">
                ✓ acá está la tarea
              </span>
            )}
          </button>
          {roots.map((node) => (
            <TreeBranch
              key={node.id}
              node={node}
              listId={listId}
              selectedParentId={selectedParentId}
              onSelect={onSelect}
              loadChildren={(parentId) =>
                listTaskChildren({ sessionToken: token!, listId, parentId })
              }
              depth={0}
              // La rama se auto-expande solo si la ruta guardada arranca en
              // este nodo; cada nivel consume su primer elemento.
              autoExpandPath={
                expandPath && expandPath[0] === node.id ? expandPath : undefined
              }
            />
          ))}
          </div>
        </div>
      )}

      {/* Crear raíz nueva */}
      <div className="mt-2 border-t border-line pt-2">
        {showCreate ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={newRootName}
              onChange={(e) => setNewRootName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreateRoot();
                }
              }}
              placeholder="[CatchUp] - 11.08.26"
              className="input min-w-0 flex-1 py-1 text-xs"
            />
            <button
              onClick={handleCreateRoot}
              disabled={creating || !newRootName.trim()}
              className="btn-primary shrink-0 px-2 py-1 text-[11px]"
            >
              {creating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Crear
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
          >
            <Plus className="h-3 w-3" /> Crear raíz nueva
          </button>
        )}
      </div>
    </div>
  );
}

// ===== Un nodo del árbol (recursivo) =====

interface TreeBranchProps {
  node: TreeNode;
  listId: string;
  selectedParentId: string | undefined;
  onSelect: (parentId: string) => void;
  loadChildren: (
    parentId: string,
  ) => Promise<{ children: TreeNode[] }>;
  depth: number;
  /**
   * Ruta a auto-expandir de la raíz hacia abajo. Si su primer elemento es este
   * nodo, la rama se abre sola al montar y pasa el resto a sus hijas.
   */
  autoExpandPath?: string[];
}

function TreeBranch({
  node,
  selectedParentId,
  onSelect,
  loadChildren,
  depth,
  autoExpandPath,
}: TreeBranchProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<TreeNode[]>([]);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [childrenLoaded, setChildrenLoaded] = useState(false);

  const isSelected = selectedParentId === node.id;
  /** Sub-ruta que le toca a las hijas (consumimos nuestro propio id). */
  const childPath =
    autoExpandPath && autoExpandPath[0] === node.id
      ? autoExpandPath.slice(1)
      : undefined;
  /**
   * Este nodo forma parte de la ruta del destino guardado. Se resalta suave
   * para que la rama se lea de un vistazo desde la raíz hasta el ancla.
   * El picker deja de pasar la ruta si el usuario re-ancla en otro lado, así
   * que el rastro se apaga solo y nunca marca una ubicación que ya no es.
   */
  const isOnPath = !!childPath && !isSelected;
  // Estamos en la rama guardada → abrir. Incluye al nodo final (el padre de la
  // tarea): así se ve la tarea misma colgando ahí, que es la confirmación
  // visual de "acá la creé". La recursión termina sola porque el último nodo
  // pasa una sub-ruta vacía y ninguna hija matchea.
  const shouldAutoExpand = !!childPath;

  /** Expande (nunca colapsa) y carga las hijas si hace falta. */
  const expand = useCallback(async () => {
    setExpanded(true);
    if (childrenLoaded) return;
    setLoadingChildren(true);
    try {
      const result = await loadChildren(node.id);
      setChildren(result.children);
      setChildrenLoaded(true);
    } catch (err) {
      toast.error("No se pudieron cargar las subtareas");
      setExpanded(false);
    } finally {
      setLoadingChildren(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childrenLoaded, node.id]);

  // Auto-expansión de la rama guardada. Solo carga datos, una única vez
  // (ref guard): no deriva estado de navegación de las props.
  const autoExpandedRef = useRef(false);
  useEffect(() => {
    if (!shouldAutoExpand || autoExpandedRef.current) return;
    autoExpandedRef.current = true;
    void expand();
  }, [shouldAutoExpand, expand]);

  // Traer a la vista el nodo anclado al abrir (una sola vez).
  const rowRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (!isSelected || scrolledRef.current || !rowRef.current) return;
    scrolledRef.current = true;
    rowRef.current.scrollIntoView({ block: "nearest" });
  }, [isSelected]);

  function handleToggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    void expand();
  }

  return (
    <div>
      <div
        ref={rowRef}
        className={cn(
          // border-l-2 siempre presente (transparente si no aplica) para que
          // resaltar no desplace las filas.
          "flex items-stretch rounded border-l-2 text-xs transition-colors",
          isSelected
            ? "border-accent bg-accent/20 ring-1 ring-accent/60"
            : isOnPath
              ? "border-accent/40 bg-accent/[0.06]"
              : "border-transparent hover:bg-panel2",
        )}
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        {/* Toggle de expandir (siempre visible, separado del click de anclar) */}
        <button
          type="button"
          onClick={handleToggle}
          className={cn(
            "grid w-5 shrink-0 place-items-center hover:text-ink",
            isSelected || isOnPath ? "text-accent" : "text-mute",
          )}
          title={expanded ? "Contraer" : "Expandir subtareas"}
        >
          {loadingChildren ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </button>
        {/* Nombre = clic ANCLA aquí (la tarea queda como hija de este nodo) */}
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-2 text-left"
          title={`Anclar la tarea como hija de "${node.name}"`}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              isSelected
                ? "font-bold text-accent"
                : isOnPath
                  ? "font-medium text-ink"
                  : "text-ink",
            )}
            title={node.name}
          >
            {node.name}
          </span>
          {isSelected && (
            <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-acfg">
              ✓ acá está la tarea
            </span>
          )}
        </button>
      </div>
      {/* Hijas (recursivo) */}
      {expanded && childrenLoaded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <TreeBranch
              key={child.id}
              node={child}
              listId={""}
              selectedParentId={selectedParentId}
              onSelect={onSelect}
              loadChildren={loadChildren}
              depth={depth + 1}
              autoExpandPath={
                childPath && childPath[0] === child.id ? childPath : undefined
              }
            />
          ))}
        </div>
      )}
      {expanded && childrenLoaded && children.length === 0 && (
        <p
          className="px-2 py-0.5 text-[10px] text-faint"
          style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}
        >
          sin subtareas
        </p>
      )}
    </div>
  );
}
