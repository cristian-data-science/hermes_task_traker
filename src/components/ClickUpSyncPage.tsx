import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useAction, useQuery } from "convex/react";
import {
  ArrowLeft,
  Loader2,
  Folder,
  List as ListIcon,
  Circle,
  ChevronRight,
  ChevronDown,
  Search,
  Check,
  Minus,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { api } from "~/convex/_generated/api";
import type {
  WorkspaceFolder,
  WorkspaceList,
  WorkspaceTask,
} from "~/convex/clickup";
import { useAuth } from "../hooks/useAuth";
import { cn } from "../lib/utils";

interface ClickUpSyncPageProps {
  onBack: () => void;
}

/** Estado de un nodo en el checkbox de 3 estados. */
type CheckState = "unchecked" | "partial" | "checked";

/** Cambios pendientes de aplicar (añadir/quitar suscripciones). */
interface PendingChange {
  nodeType: "folder" | "list" | "task";
  id: string;
  label: string;
}

/**
 * Página completa de sincronización ClickUp: un explorador del workspace con
 * checkboxes de 3 estados para suscribirse a folders/lists/tareas.
 *
 * Marcás qué querés importar y mantener sincronizado, y "Aplicar" dispara el
 * importe inmediato + persiste las suscripciones.
 */
export function ClickUpSyncPage({ onBack }: ClickUpSyncPageProps) {
  const { token } = useAuth();
  const getTree = useAction(api.clickup.getWorkspaceTree);
  const applySubs = useAction(api.clickup.applySubscriptions);
  const clickupState = useQuery(
    api.settings.getClickupState,
    token ? { sessionToken: token } : "skip",
  );
  const importedIds = useQuery(
    api.settings.getImportedClickupIds,
    token ? { sessionToken: token } : "skip",
  );

  const [tree, setTree] = useState<WorkspaceFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [search, setSearch] = useState("");

  // Suscripciones actuales (persistidas) + cambios pendientes locales.
  const persistedSubs = useMemo(() => {
    const map = new Map<string, PendingChange>();
    for (const s of clickupState?.subscriptions ?? []) {
      map.set(s.id, {
        nodeType: s.nodeType as PendingChange["nodeType"],
        id: s.id,
        label: s.label,
      });
    }
    return map;
  }, [clickupState?.subscriptions]);

  const [localSubs, setLocalSubs] = useState<Map<string, PendingChange>>(
    new Map(),
  );
  /**
   * ids que el usuario desmarcó explícitamente (para des-trackear). Como las
   * tareas ya importadas aparecen en subIds por la unión con importedIds, no
   * basta con borrarlas de localSubs (no están ahí). Este set las marca como
   * "el usuario no la quiere" para que subIds las excluya.
   */
  const [untracked, setUntracked] = useState<Set<string>>(new Set());

  // Sincronizar localSubs con persistedSubs al cargar.
  useEffect(() => {
    setLocalSubs(new Map(persistedSubs));
  }, [persistedSubs]);

  // Cargar el árbol al montar.
  const loadTree = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const result = await getTree({ sessionToken: token });
      setTree(result.folders);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error al cargar ClickUp",
      );
    } finally {
      setLoading(false);
    }
  }, [token, getTree]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  // ===== Cálculo del estado de cada nodo (3 estados) =====
  /**
   * Set de ids "activos" para el checkbox: la unión de las suscripciones
   * (locales) + las tareas ya importadas en Hermes. Así una tarea que ya
   * existe en Hermes aparece como checkeada aunque no tenga suscripción
   * explícita — refleja la realidad de que ya está sincronizada.
   */
  const subIds = useMemo(() => {
    const ids = new Set<string>(localSubs.keys());
    for (const id of importedIds ?? []) {
      if (!untracked.has(id)) ids.add(id);
    }
    // Quitar de subIds lo que el usuario desmarcó explícitamente.
    for (const id of untracked) ids.delete(id);
    return ids;
  }, [localSubs, importedIds, untracked]);

  // ===== Expansión del árbol (controlada desde acá) =====
  // Un único Set con los nodos abiertos. Vive en la página, no en cada nodo,
  // para poder sembrarlo con lo que ya está suscripto y ofrecer expandir /
  // colapsar todo.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  /** La siembra corre UNA sola vez, cuando ya hay árbol y suscripciones. */
  const seededRef = useRef(false);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /**
   * Ids a abrir para que TODA suscripción quede a la vista: los ancestros de
   * cada nodo suscripto, más los folders/lists suscriptos (para ver su
   * contenido). Una tarea suscripta no se abre a sí misma: su checkbox ya se
   * ve desde el padre y abrirla solo agregaría ruido.
   */
  const computeAutoExpand = useCallback(
    (folders: WorkspaceFolder[], active: Set<string>) => {
      const open = new Set<string>();
      /** Devuelve true si la tarea o alguna descendiente está suscripta. */
      const walkTask = (task: WorkspaceTask): boolean => {
        let hasSubInside = false;
        for (const child of task.children) {
          if (walkTask(child)) hasSubInside = true;
        }
        if (hasSubInside) open.add(task.id);
        return hasSubInside || active.has(task.id);
      };
      for (const folder of folders) {
        let folderHas = false;
        for (const list of folder.lists) {
          let listHas = active.has(list.id);
          for (const task of list.tasks) {
            if (walkTask(task)) listHas = true;
          }
          if (listHas) {
            open.add(list.id);
            folderHas = true;
          }
        }
        if (folderHas || active.has(folder.id)) open.add(folder.id);
      }
      return open;
    },
    [],
  );

  useEffect(() => {
    if (seededRef.current) return;
    if (tree.length === 0) return;
    // Esperar a que las queries reactivas hayan resuelto, si no sembraríamos
    // con datos incompletos y quedaría medio árbol cerrado.
    if (importedIds === undefined || clickupState === undefined) return;
    seededRef.current = true;
    setExpandedIds(computeAutoExpand(tree, subIds));
  }, [tree, importedIds, clickupState, subIds, computeAutoExpand]);

  /** Todos los ids del árbol (para "expandir todo"). */
  const allNodeIds = useMemo(() => {
    const ids = new Set<string>();
    const walk = (t: WorkspaceTask) => {
      if (t.children.length > 0) ids.add(t.id);
      t.children.forEach(walk);
    };
    for (const f of tree) {
      ids.add(f.id);
      for (const l of f.lists) {
        ids.add(l.id);
        l.tasks.forEach(walk);
      }
    }
    return ids;
  }, [tree]);

  /** Estado de un folder: checked si todas sus lists+tasks están suscriptas. */
  function folderState(folder: WorkspaceFolder): CheckState {
    const allDescendants: string[] = [];
    for (const list of folder.lists) {
      allDescendants.push(list.id);
      for (const t of list.tasks) allDescendants.push(t.id);
    }
    if (allDescendants.length === 0) return "unchecked";
    const checked = allDescendants.filter((id) => subIds.has(id)).length;
    if (checked === 0) return "unchecked";
    if (checked === allDescendants.length) return "checked";
    return "partial";
  }

  /** Estado de una list. */
  function listState(list: WorkspaceList): CheckState {
    const all = [list.id, ...list.tasks.map((t) => t.id)];
    const checked = all.filter((id) => subIds.has(id)).length;
    if (checked === 0) return "unchecked";
    if (checked === all.length) return "checked";
    return "partial";
  }

  /** Toggle de un folder: si no está todo checked → marcar todo; si no → vaciar. */
  function toggleFolder(folder: WorkspaceFolder) {
    const state = folderState(folder);
    const nextSubs = new Map(localSubs);
    const nextUntracked = new Set(untracked);
    const ids: { nodeType: PendingChange["nodeType"]; id: string; label: string }[] = [
      { nodeType: "folder", id: folder.id, label: folder.name },
    ];
    for (const list of folder.lists) {
      ids.push({ nodeType: "list", id: list.id, label: list.name });
      for (const t of list.tasks) {
        ids.push({ nodeType: "task", id: t.id, label: t.name });
      }
    }
    if (state === "checked") {
      // Vaciar: quitar todos de localSubs y añadir a untracked.
      for (const { id } of ids) {
        nextSubs.delete(id);
        nextUntracked.add(id);
      }
    } else {
      // Marcar todos: añadir a localSubs y quitar de untracked.
      for (const n of ids) {
        nextSubs.set(n.id, n);
        nextUntracked.delete(n.id);
      }
    }
    setLocalSubs(nextSubs);
    setUntracked(nextUntracked);
  }

  /** Toggle de una list. */
  function toggleList(list: WorkspaceList, folderName: string) {
    const state = listState(list);
    const nextSubs = new Map(localSubs);
    const nextUntracked = new Set(untracked);
    const ids: { nodeType: PendingChange["nodeType"]; id: string; label: string }[] = [
      { nodeType: "list", id: list.id, label: `${folderName} · ${list.name}` },
    ];
    for (const t of list.tasks) {
      ids.push({ nodeType: "task", id: t.id, label: t.name });
    }
    if (state === "checked") {
      for (const { id } of ids) {
        nextSubs.delete(id);
        nextUntracked.add(id);
      }
    } else {
      for (const n of ids) {
        nextSubs.set(n.id, n);
        nextUntracked.delete(n.id);
      }
    }
    setLocalSubs(nextSubs);
    setUntracked(nextUntracked);
  }

  /**
   * Toggle de una tarea individual, a cualquier profundidad.
   * `labelPrefix` es la ruta de ancestros (ej. "Ley de Datos · FASE 1"), para
   * que la suscripción quede identificable en la lista de suscripciones.
   */
  function toggleTask(task: WorkspaceTask, labelPrefix: string) {
    const isActive = subIds.has(task.id);
    const nextSubs = new Map(localSubs);
    const nextUntracked = new Set(untracked);
    if (isActive) {
      // Desmarcar: quitar de localSubs si está, y añadir a untracked.
      nextSubs.delete(task.id);
      nextUntracked.add(task.id);
    } else {
      // Marcar: añadir a localSubs y quitar de untracked.
      nextSubs.set(task.id, {
        nodeType: "task",
        id: task.id,
        label: `${labelPrefix} · ${task.name}`,
      });
      nextUntracked.delete(task.id);
    }
    setLocalSubs(nextSubs);
    setUntracked(nextUntracked);
  }

  // ===== Detección de cambios pendientes =====
  const { added, removed } = useMemo(() => {
    const added: PendingChange[] = [];
    const removed: string[] = [];
    for (const [id, node] of localSubs) {
      if (!persistedSubs.has(id)) added.push(node);
    }
    for (const id of persistedSubs.keys()) {
      if (!localSubs.has(id)) removed.push(id);
    }
    // ids desmarcadas explícitamente (untracked): marcar para ignorar.
    for (const id of untracked) {
      if (!removed.includes(id)) removed.push(id);
    }
    return { added, removed };
  }, [localSubs, persistedSubs, untracked]);

  const hasChanges = added.length > 0 || removed.length > 0;

  async function handleApply() {
    if (!token || !hasChanges) return;
    setApplying(true);
    try {
      const result = await applySubs({
        sessionToken: token,
        add: added,
        remove: removed,
      });
      const r = result as {
        tasksImported: number;
        tasksSkipped: number;
        tasksIgnored: number;
        subscriptionsAdded: number;
        subscriptionsRemoved: number;
      };
      const parts: string[] = [];
      if (r.tasksImported > 0)
        parts.push(`${r.tasksImported} importada${r.tasksImported !== 1 ? "s" : ""}`);
      if (r.tasksIgnored > 0)
        parts.push(`${r.tasksIgnored} eliminada${r.tasksIgnored !== 1 ? "s" : ""}`);
      if (r.tasksSkipped > 0)
        parts.push(`${r.tasksSkipped} ya existían`);
      toast.success(parts.length > 0 ? parts.join(" · ") : "Sin cambios");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error al aplicar suscripciones",
      );
    } finally {
      setApplying(false);
      // Tras aplicar, vaciar untracked. localSubs se resincroniza solo cuando
      // persistedSubs (query reactiva) se actualice tras el cambio en la DB.
      setUntracked(new Set());
    }
  }

  // ===== Filtrado por búsqueda =====
  const q = search.trim().toLowerCase();
  const matches = (s: string) => !q || s.toLowerCase().includes(q);

  /**
   * Filtra una tarea y su subárbol: se conserva si ella matchea (con todas sus
   * hijas) o si alguna descendiente matchea (podando el resto). Sin esto, una
   * subtarea profunda que coincide con la búsqueda quedaba invisible porque el
   * filtro solo miraba las tareas raíz.
   */
  const filterTask = useCallback(
    (task: WorkspaceTask, query: string): WorkspaceTask | null => {
      const self = task.name.toLowerCase().includes(query);
      if (self) return task;
      const kids = task.children
        .map((c) => filterTask(c, query))
        .filter((c): c is WorkspaceTask => c !== null);
      if (kids.length === 0) return null;
      return { ...task, children: kids };
    },
    [],
  );

  const filteredTree = useMemo(() => {
    if (!q) return tree;
    return tree
      .map((folder) => ({
        ...folder,
        lists: folder.lists
          .map((list) => ({
            ...list,
            tasks: list.tasks
              .map((t) => filterTask(t, q))
              .filter((t): t is WorkspaceTask => t !== null),
          }))
          .filter(
            (list) => matches(list.name) || list.tasks.length > 0,
          ),
      }))
      .filter(
        (folder) => matches(folder.name) || folder.lists.length > 0,
      );
  }, [tree, q, filterTask]);

  /** Ids del árbol filtrado, para abrir los resultados de la búsqueda. */
  const filteredNodeIds = useMemo(() => {
    if (!q) return null;
    const ids = new Set<string>();
    const walk = (t: WorkspaceTask) => {
      if (t.children.length > 0) ids.add(t.id);
      t.children.forEach(walk);
    };
    for (const f of filteredTree) {
      ids.add(f.id);
      for (const l of f.lists) {
        ids.add(l.id);
        l.tasks.forEach(walk);
      }
    }
    return ids;
  }, [filteredTree, q]);

  // Al buscar, abrir los resultados; el Set de búsqueda no pisa el del usuario
  // (se combina en el render), así que al limpiar la búsqueda vuelve lo suyo.
  const effectiveExpanded = filteredNodeIds ?? expandedIds;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header — fijo arriba, siempre visible */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="btn-ghost p-1.5 hover:bg-panel2"
            title="Volver al tablero"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="font-display text-base font-bold text-ink">
            ClickUp · Sincronización
          </h1>
        </div>
        <button
          onClick={onBack}
          className="rounded-el p-1.5 text-faint transition-colors hover:bg-panel2 hover:text-ink"
          title="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Body */}
      <div className="mx-auto w-full max-w-3xl min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        {/* Buscador */}
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar carpeta, lista o tarea…"
            className="input pl-9 pr-8"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-faint hover:bg-panel2 hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Controles de expansión. Al entrar, el árbol ya viene abierto en
            todo lo suscripto; estos botones son la salida rápida. */}
        {!loading && filteredTree.length > 0 && (
          <div className="mb-2 flex items-center justify-end gap-3 text-[11px]">
            <span className="mr-auto text-faint">
              {subIds.size} suscripto{subIds.size !== 1 ? "s" : ""} · abierto en
              sus ubicaciones
            </span>
            <button
              type="button"
              onClick={() => setExpandedIds(new Set(allNodeIds))}
              className="text-mute hover:text-ink hover:underline"
            >
              Expandir todo
            </button>
            <button
              type="button"
              onClick={() => setExpandedIds(new Set())}
              className="text-mute hover:text-ink hover:underline"
            >
              Colapsar todo
            </button>
            <button
              type="button"
              onClick={() => setExpandedIds(computeAutoExpand(tree, subIds))}
              className="text-accent hover:underline"
              title="Volver a abrir solo las ramas que tienen suscripciones"
            >
              Solo lo suscripto
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-mute">
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-accent" />
            <p className="text-sm">Cargando estructura de ClickUp…</p>
          </div>
        ) : filteredTree.length === 0 ? (
          <div className="py-20 text-center text-mute">
            <p className="text-sm">
              {q ? "Sin resultados para la búsqueda." : "No hay carpetas."}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredTree.map((folder) => (
              <FolderNode
                key={folder.id}
                folder={folder}
                state={folderState(folder)}
                onToggle={() => toggleFolder(folder)}
                onToggleList={(list) => toggleList(list, folder.name)}
                onToggleTask={toggleTask}
                listStateFn={listState}
                subIds={subIds}
                expandedIds={effectiveExpanded}
                onToggleExpanded={toggleExpanded}
              />
            ))}
          </div>
        )}

        {/* Leyenda */}
        <div className="mt-6 flex items-center gap-4 border-t border-line pt-4 text-[11px] text-faint">
          <span className="inline-flex items-center gap-1">
            <TriIcon state="checked" /> suscripto
          </span>
          <span className="inline-flex items-center gap-1">
            <TriIcon state="partial" /> parcial
          </span>
          <span className="inline-flex items-center gap-1">
            <TriIcon state="unchecked" /> no suscripto
          </span>
        </div>
      </div>

      {/* Footer fijo: siempre visible con el botón Aplicar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-panel px-4 py-3 sm:px-6">
        <span className="text-xs text-mute">
          {hasChanges ? (
            <>
              {added.length} para añadir
              {removed.length > 0 && ` · ${removed.length} para quitar`}
            </>
          ) : (
            "Sin cambios pendientes"
          )}
        </span>
        <button
          onClick={handleApply}
          disabled={!hasChanges || applying}
          className="btn-primary px-4 py-2 text-sm"
        >
          {applying ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Aplicar {hasChanges ? `(${added.length + removed.length})` : ""}
        </button>
      </div>
    </div>
  );
}

// ============================================================
//  Nodos del árbol (folder > list > task)
// ============================================================

interface FolderNodeProps {
  folder: WorkspaceFolder;
  state: CheckState;
  onToggle: () => void;
  onToggleList: (list: WorkspaceList) => void;
  onToggleTask: (task: WorkspaceTask, labelPrefix: string) => void;
  listStateFn: (list: WorkspaceList) => CheckState;
  subIds: Set<string>;
  expandedIds: Set<string>;
  onToggleExpanded: (id: string) => void;
}

function FolderNode({
  folder,
  state,
  onToggle,
  onToggleList,
  onToggleTask,
  listStateFn,
  subIds,
  expandedIds,
  onToggleExpanded,
}: FolderNodeProps) {
  const expanded = expandedIds.has(folder.id);
  const setExpanded = () => onToggleExpanded(folder.id);

  return (
    <div className="overflow-hidden rounded-el border-el border-line">
      {/* Cabecera del folder */}
      <div className="flex items-center gap-2 bg-panel2 px-2.5 py-2">
        <button
          onClick={setExpanded}
          className="grid h-5 w-5 place-items-center rounded text-mute hover:text-ink"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <TriCheckbox state={state} onChange={onToggle} />
        <Folder className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {folder.name}
        </span>
        <span className="shrink-0 text-[10px] text-faint">
          {folder.lists.length} list{folder.lists.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Lists del folder */}
      {expanded && (
        <div className="space-y-0.5 p-1.5">
          {folder.lists.map((list) => (
            <ListNode
              key={list.id}
              list={list}
              folderName={folder.name}
              state={listStateFn(list)}
              onToggle={() => onToggleList(list)}
              onToggleTask={onToggleTask}
              subIds={subIds}
              expandedIds={expandedIds}
              onToggleExpanded={onToggleExpanded}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ListNodeProps {
  list: WorkspaceList;
  folderName: string;
  state: CheckState;
  onToggle: () => void;
  onToggleTask: (task: WorkspaceTask, labelPrefix: string) => void;
  subIds: Set<string>;
  expandedIds: Set<string>;
  onToggleExpanded: (id: string) => void;
}

function ListNode({
  list,
  state,
  onToggle,
  onToggleTask,
  subIds,
  expandedIds,
  onToggleExpanded,
}: ListNodeProps) {
  const expanded = expandedIds.has(list.id);

  return (
    <div className="rounded px-1">
      {/* Cabecera de la list */}
      <div className="flex items-center gap-2 px-1.5 py-1.5 hover:bg-panel2">
        <button
          onClick={() => onToggleExpanded(list.id)}
          className="grid h-4 w-4 place-items-center rounded text-mute hover:text-ink"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <TriCheckbox state={state} onChange={onToggle} />
        <ListIcon className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {list.name}
        </span>
        <span className="shrink-0 text-[10px] text-faint">
          {list.tasks.length} tarea{list.tasks.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Tareas de la list */}
      {expanded && (
        <div className="ml-2 space-y-0.5 border-l border-line pl-2">
          {list.tasks.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-faint">
              Sin tareas raíz.
            </p>
          ) : (
            list.tasks.map((task) => (
              <TaskNode
                key={task.id}
                task={task}
                labelPrefix={list.name}
                subIds={subIds}
                onToggleTask={onToggleTask}
                expandedIds={expandedIds}
                onToggleExpanded={onToggleExpanded}
                depth={0}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface TaskNodeProps {
  task: WorkspaceTask;
  /** Ruta legible de los ancestros, para etiquetar la suscripción. */
  labelPrefix: string;
  subIds: Set<string>;
  onToggleTask: (task: WorkspaceTask, labelPrefix: string) => void;
  expandedIds: Set<string>;
  onToggleExpanded: (id: string) => void;
  depth: number;
}

/**
 * Nodo de tarea RECURSIVO: se expande sin límite de profundidad.
 *
 * Antes esto era un nodo hoja: pintaba sus subtareas como <div> planos, sin
 * chevron ni checkbox, así que el árbol moría en el nivel 4 (folder → list →
 * tarea → subtarea) y no se podía bajar a las fases de un proyecto ni
 * suscribirse a nada más profundo. El backend nunca tuvo ese límite.
 *
 * Las hijas vienen ya anidadas en `task.children` (getWorkspaceTree arma el
 * árbol completo), así que no hay carga on-demand: la página puede abrirse
 * directamente en los nodos suscriptos sin ir pidiendo nivel por nivel.
 *
 * La expansión es CONTROLADA por la página (expandedIds), no estado local: es
 * lo que permite sembrarla con lo suscripto y ofrecer expandir/colapsar todo.
 */
function TaskNode({
  task,
  labelPrefix,
  subIds,
  onToggleTask,
  expandedIds,
  onToggleExpanded,
  depth,
}: TaskNodeProps) {
  const checked = subIds.has(task.id);
  const childPrefix = `${labelPrefix} · ${task.name}`;
  const children = task.children;
  const hasChildren = children.length > 0;
  const expanded = hasChildren && expandedIds.has(task.id);

  return (
    <div>
      <div className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-panel2">
        <button
          onClick={() => hasChildren && onToggleExpanded(task.id)}
          disabled={!hasChildren}
          className={cn(
            "grid h-3.5 w-3.5 place-items-center rounded text-faint",
            hasChildren ? "hover:text-ink" : "cursor-default opacity-0",
          )}
          title={
            !hasChildren
              ? "Sin subtareas"
              : expanded
                ? "Contraer"
                : `Ver ${children.length} subtarea${children.length !== 1 ? "s" : ""}`
          }
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </button>
        <TriCheckbox
          state={checked ? "checked" : "unchecked"}
          onChange={() => onToggleTask(task, labelPrefix)}
        />
        <Circle
          className={cn(
            "shrink-0 fill-current text-mute",
            depth === 0 ? "h-2.5 w-2.5" : "h-2 w-2 opacity-60",
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            depth === 0 ? "text-[13px] text-ink" : "text-[12px] text-ink/90",
          )}
          title={task.name}
        >
          {task.name}
        </span>
        {task.assignee && (
          <span className="shrink-0 rounded-full bg-panel2 px-1.5 py-0.5 text-[10px] font-medium text-mute">
            {task.assignee}
          </span>
        )}
      </div>

      {/* Hijas: mismas capacidades que el padre, sin tope de profundidad. */}
      {expanded && (
        <div className="ml-3 space-y-0.5 border-l border-line pl-2">
          {children.map((child) => (
            <TaskNode
              key={child.id}
              task={child}
              labelPrefix={childPrefix}
              subIds={subIds}
              onToggleTask={onToggleTask}
              expandedIds={expandedIds}
              onToggleExpanded={onToggleExpanded}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
//  Checkbox de 3 estados
// ============================================================

function TriCheckbox({
  state,
  onChange,
}: {
  state: CheckState;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={cn(
        "grid h-4 w-4 shrink-0 place-items-center rounded border-el transition-colors",
        state === "checked"
          ? "border-accent bg-accent text-acfg"
          : state === "partial"
            ? "border-accent bg-accent/30 text-accent"
            : "border-line bg-panel hover:border-mute",
      )}
      aria-label={state}
    >
      {state === "checked" && <Check className="h-3 w-3" />}
      {state === "partial" && <Minus className="h-3 w-3" />}
    </button>
  );
}

/** Solo el icono del estado (para la leyenda). */
function TriIcon({ state }: { state: CheckState }) {
  return (
    <span
      className={cn(
        "grid h-3.5 w-3.5 place-items-center rounded border",
        state === "checked"
          ? "border-accent bg-accent text-acfg"
          : state === "partial"
            ? "border-accent bg-accent/30 text-accent"
            : "border-line",
      )}
    >
      {state === "checked" && <Check className="h-2.5 w-2.5" />}
      {state === "partial" && <Minus className="h-2.5 w-2.5" />}
    </span>
  );
}
