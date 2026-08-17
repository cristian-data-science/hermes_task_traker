import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAction } from "convex/react";
import {
  X,
  Loader2,
  RefreshCw,
  CheckCircle2,
  ArrowRight,
  Ban,
  Check,
  Search,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
} from "lucide-react";
import toast from "react-hot-toast";
import { api } from "~/convex/_generated/api";
import { STATUSES, STATUS_META, type Status } from "../lib/constants";
import { useAuth } from "../hooks/useAuth";
import { cn } from "../lib/utils";

interface InboundSyncModalProps {
  open: boolean;
  onClose: () => void;
}

/** Ítem nuevo con metadata de jerarquía para agrupar. */
interface NewItem {
  clickupId: string;
  name: string;
  parent: string | null;
  listId: string;
  destinationLabel: string;
  selected: boolean;
  status: Status;
}

/** Ítem de cambio de estado. */
interface ChangeItem {
  taskId: string;
  clickupId: string;
  name: string;
  listId: string;
  destinationLabel: string;
  currentStatus: Status;
  clickupStatus: string;
  selected: boolean;
  status: Status;
}

/** Un grupo de proyecto/list para la preselección. */
interface ProjectGroup {
  listId: string;
  label: string;
  newsCount: number;
  changesCount: number;
}

/**
 * Modal de sincronización reversa (ClickUp → Hermes), rediseñado:
 *
 * Estructura de arriba a abajo:
 *  1. Buscador de texto (filtra por nombre en tiempo real).
 *  2. Preselección por proyecto/list (toggles que descartan grupos enteros).
 *  3. Vista jerárquica: grupos plegables, dentro nuevas (anidadas por parent) +
 *     cambios de estado, cada ítem con badge NUEVA / CAMBIO DE ESTADO.
 *
 * El footer aplica lo checkeado (crea / actualiza / ignora).
 */
export function InboundSyncModal({ open, onClose }: InboundSyncModalProps) {
  const { token } = useAuth();
  const getDiff = useAction(api.clickup.getInboundDiff);
  const submit = useAction(api.clickup.submitInbound);

  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [newItems, setNewItems] = useState<NewItem[]>([]);
  const [changeItems, setChangeItems] = useState<ChangeItem[]>([]);
  const [scanned, setScanned] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Cargar la diff al abrir el modal.
  useEffect(() => {
    if (!open || !token) return;
    let cancelled = false;
    setLoading(true);
    setScanned(false);
    setSearch("");
    setCollapsedGroups(new Set());
    getDiff({ sessionToken: token })
      .then((diff) => {
        if (cancelled) return;
        setNewItems(
          (diff.newTasks ?? []).map((t) => ({
            clickupId: t.clickupId,
            name: t.name,
            parent: t.parent,
            listId: t.listId,
            destinationLabel: t.destinationLabel,
            selected: true,
            status: t.suggestedStatus as Status,
          })),
        );
        setChangeItems(
          (diff.statusChanges ?? []).map((c) => ({
            taskId: c.taskId,
            clickupId: c.clickupId,
            name: c.name,
            listId: "",
            destinationLabel: "",
            currentStatus: c.currentStatus as Status,
            clickupStatus: c.clickupStatus,
            selected: true,
            status: c.suggestedStatus as Status,
          })),
        );
        setScanned(true);
      })
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : "Error al escanear ClickUp",
        );
        setScanned(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, token, getDiff]);

  // ===== Filtrado por búsqueda =====
  const q = search.trim().toLowerCase();
  const filterFn = (name: string) =>
    !q || name.toLowerCase().includes(q);

  const filteredNews = useMemo(
    () => newItems.filter((i) => filterFn(i.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [newItems, q],
  );
  const filteredChanges = useMemo(
    () => changeItems.filter((i) => filterFn(i.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [changeItems, q],
  );

  // ===== Grupos de proyecto/list (para preselección + cabeceras) =====
  const groups = useMemo<ProjectGroup[]>(() => {
    const map = new Map<string, ProjectGroup>();
    for (const n of filteredNews) {
      const g = map.get(n.listId) ?? {
        listId: n.listId,
        label: n.destinationLabel,
        newsCount: 0,
        changesCount: 0,
      };
      g.newsCount++;
      map.set(n.listId, g);
    }
    for (const c of filteredChanges) {
      const key = c.listId || "__changes__";
      const g = map.get(key) ?? {
        listId: key,
        label: c.destinationLabel || "Cambios de estado",
        newsCount: 0,
        changesCount: 0,
      };
      g.changesCount++;
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [filteredNews, filteredChanges]);

  // ===== Handlers de selección =====
  function toggleNew(id: string) {
    setNewItems((items) =>
      items.map((i) => (i.clickupId === id ? { ...i, selected: !i.selected } : i)),
    );
  }
  function toggleChange(taskId: string) {
    setChangeItems((items) =>
      items.map((i) => (i.taskId === taskId ? { ...i, selected: !i.selected } : i)),
    );
  }
  function setNewStatus(id: string, status: Status) {
    setNewItems((items) =>
      items.map((i) => (i.clickupId === id ? { ...i, status } : i)),
    );
  }
  function setChangeStatus(taskId: string, status: Status) {
    setChangeItems((items) =>
      items.map((i) => (i.taskId === taskId ? { ...i, status } : i)),
    );
  }

  /** Selecciona/deselecciona todas las tareas (nuevas + cambios) de un grupo. */
  function toggleGroup(listId: string, value: boolean) {
    const newsIds = new Set(filteredNews.filter((n) => n.listId === listId).map((n) => n.clickupId));
    const changeIds = new Set(
      filteredChanges
        .filter((c) => (c.listId || "__changes__") === listId)
        .map((c) => c.taskId),
    );
    setNewItems((items) =>
      items.map((i) => (newsIds.has(i.clickupId) ? { ...i, selected: value } : i)),
    );
    setChangeItems((items) =>
      items.map((i) => (changeIds.has(i.taskId) ? { ...i, selected: value } : i)),
    );
  }

  function toggleCollapse(listId: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(listId)) next.delete(listId);
      else next.add(listId);
      return next;
    });
  }

  // ===== Conteos para el footer =====
  const selectedNews = newItems.filter((i) => i.selected);
  const selectedChanges = changeItems.filter((i) => i.selected);
  const totalSelected = selectedNews.length + selectedChanges.length;
  const totalIgnored = newItems.filter((i) => !i.selected).length;

  async function handleApply() {
    if (!token) return;
    setApplying(true);
    try {
      const result = await submit({
        sessionToken: token,
        newTasks: selectedNews.map((i) => ({
          clickupId: i.clickupId,
          name: i.name,
          status: i.status,
          parent: i.parent ?? undefined,
        })),
        statusChanges: selectedChanges.map((i) => ({
          taskId: i.taskId as any,
          status: i.status,
        })),
        ignoreClickupIds: newItems
          .filter((i) => !i.selected)
          .map((i) => i.clickupId),
      });
      const created = (result as any)?.created ?? 0;
      const updated = (result as any)?.updated ?? 0;
      const ignored = (result as any)?.ignored ?? 0;
      toast.success(
        `${created} creadas · ${updated} actualizadas${ignored ? ` · ${ignored} ignoradas` : ""}`,
      );
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error al aplicar cambios",
      );
    } finally {
      setApplying(false);
    }
  }

  const isEmpty = scanned && newItems.length === 0 && changeItems.length === 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 48, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 340, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border-el border-line bg-panel shadow-el-lg sm:max-h-[90vh] sm:rounded-el-lg"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-line px-4 py-3.5 sm:px-5 sm:py-4">
              <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
                <RefreshCw className="h-4 w-4 text-accent" />
                Sincronizar desde ClickUp
              </h2>
              <button
                onClick={onClose}
                className="rounded-el p-1.5 text-faint transition-colors hover:bg-panel2 hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-16 text-mute">
                  <Loader2 className="mb-3 h-8 w-8 animate-spin text-accent" />
                  <p className="text-sm">Escaneando ClickUp…</p>
                </div>
              ) : isEmpty ? (
                <div className="flex flex-col items-center justify-center py-16 text-center text-mute">
                  <CheckCircle2 className="mb-3 h-10 w-10 text-accent" />
                  <p className="text-sm font-medium text-ink">
                    Todo sincronizado
                  </p>
                  <p className="text-xs">
                    No hay tareas nuevas ni cambios de estado en los proyectos
                    que monitoreás.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* 1) Buscador */}
                  {(newItems.length > 0 || changeItems.length > 0) && (
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Filtrar tareas por nombre…"
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
                  )}

                  {/* 2) Preselección por proyecto */}
                  {groups.length > 0 && (
                    <div>
                      <p className="label">Proyectos</p>
                      <p className="mb-2 text-xs text-mute">
                        Apaga los que no te interesan sincronizar.
                      </p>
                      <div className="space-y-1">
                        {groups.map((g) => {
                          const groupNews = filteredNews.filter((n) => n.listId === g.listId);
                          const groupChanges = filteredChanges.filter(
                            (c) => (c.listId || "__changes__") === g.listId,
                          );
                          const allSelected =
                            groupNews.every((n) => n.selected) &&
                            groupChanges.every((c) => c.selected);
                          return (
                            <GroupToggle
                              key={g.listId}
                              label={g.label}
                              newsCount={g.newsCount}
                              changesCount={g.changesCount}
                              allSelected={allSelected}
                              onToggle={() => toggleGroup(g.listId, !allSelected)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 3) Vista jerárquica por grupo */}
                  <div className="space-y-2">
                    {groups.map((g) => {
                      const groupNews = filteredNews.filter((n) => n.listId === g.listId);
                      const groupChanges = filteredChanges.filter(
                        (c) => (c.listId || "__changes__") === g.listId,
                      );
                      if (groupNews.length === 0 && groupChanges.length === 0) return null;
                      const collapsed = collapsedGroups.has(g.listId);
                      const groupAllSelected =
                        groupNews.every((n) => n.selected) &&
                        groupChanges.every((c) => c.selected);
                      return (
                        <GroupSection
                          key={g.listId}
                          label={g.label}
                          newsCount={groupNews.length}
                          changesCount={groupChanges.length}
                          collapsed={collapsed}
                          allSelected={groupAllSelected}
                          onToggleCollapse={() => toggleCollapse(g.listId)}
                          onToggleAll={() => toggleGroup(g.listId, !groupAllSelected)}
                        >
                          {/* Nuevas anidadas por parent */}
                          {groupNews.length > 0 && (
                            <NestedItems
                              items={groupNews}
                              onToggle={toggleNew}
                              onStatusChange={setNewStatus}
                            />
                          )}
                          {/* Cambios de estado */}
                          {groupChanges.length > 0 && (
                            <div className={cn(groupNews.length > 0 && "mt-2 border-t border-line pt-2")}>
                              {groupChanges.map((item) => (
                                <DiffRow
                                  key={item.taskId}
                                  type="change"
                                  selected={item.selected}
                                  onToggle={() => toggleChange(item.taskId)}
                                  title={item.name}
                                  subtitle={`${STATUS_META[item.currentStatus].label} → ClickUp: ${item.clickupStatus}`}
                                  status={item.status}
                                  onStatusChange={(s) => setChangeStatus(item.taskId, s)}
                                />
                              ))}
                            </div>
                          )}
                        </GroupSection>
                      );
                    })}
                  </div>

                  {/* Aviso de ignoradas */}
                  {totalIgnored > 0 && (
                    <p className="flex items-center gap-1 text-[11px] text-faint">
                      <Ban className="h-3 w-3" />
                      {totalIgnored} no seleccionada
                      {totalIgnored !== 1 ? "s" : ""} se marcará
                      {totalIgnored !== 1 ? "n" : ""} como ignorada
                      {totalIgnored !== 1 ? "s" : ""}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
              <span className="text-xs text-mute">
                {totalSelected > 0
                  ? `${totalSelected} seleccionada${totalSelected !== 1 ? "s" : ""}`
                  : ""}
              </span>
              <div className="flex gap-2">
                <button onClick={onClose} className="btn-secondary">
                  Cancelar
                </button>
                <button
                  onClick={handleApply}
                  disabled={applying || totalSelected === 0}
                  className="btn-primary"
                >
                  {applying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Aplicar {totalSelected > 0 ? totalSelected : ""}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ============================================================
//  Sub-componentes
// ============================================================

/** Toggle de preselección por proyecto. */
function GroupToggle({
  label,
  newsCount,
  changesCount,
  allSelected,
  onToggle,
}: {
  label: string;
  newsCount: number;
  changesCount: number;
  allSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 rounded-el border-el border-line p-2 hover:bg-panel2">
      <div className="flex min-w-0 items-center gap-2">
        <Checkbox checked={allSelected} onChange={onToggle} />
        <span className="min-w-0 truncate text-sm font-medium text-ink">
          {label}
        </span>
      </div>
      <span className="shrink-0 text-[11px] text-mute">
        {newsCount > 0 && `${newsCount} nueva${newsCount !== 1 ? "s" : ""}`}
        {newsCount > 0 && changesCount > 0 && " · "}
        {changesCount > 0 && `${changesCount} cambio${changesCount !== 1 ? "s" : ""}`}
      </span>
    </label>
  );
}

/** Sección plegable de un grupo con cabecera. */
function GroupSection({
  label,
  newsCount,
  changesCount,
  collapsed,
  allSelected,
  onToggleCollapse,
  onToggleAll,
  children,
}: {
  label: string;
  newsCount: number;
  changesCount: number;
  collapsed: boolean;
  allSelected: boolean;
  onToggleCollapse: () => void;
  onToggleAll: () => void;
  children: React.ReactNode;
}) {
  const total = newsCount + changesCount;
  return (
    <div className="overflow-hidden rounded-el border-el border-line">
      <div className="flex items-center gap-2 bg-panel2 px-2.5 py-2">
        <Checkbox checked={allSelected} onChange={onToggleAll} />
        <button
          onClick={onToggleCollapse}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-mute" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-mute" />
          )}
          <span className="min-w-0 truncate text-sm font-semibold text-ink">
            {label}
          </span>
          <span className="shrink-0 text-[10px] text-faint">({total})</span>
        </button>
      </div>
      {!collapsed && <div className="space-y-0.5 p-1.5">{children}</div>}
    </div>
  );
}

/**
 * Renderiza las tareas nuevas anidadas por parent. Construye un árbol:
 * - Las que tienen parent cuyo clickupId también está en el array → hijas.
 * - Las que no (parent null o no encontrado) → raíces del grupo.
 */
function NestedItems({
  items,
  onToggle,
  onStatusChange,
}: {
  items: NewItem[];
  onToggle: (id: string) => void;
  onStatusChange: (id: string, status: Status) => void;
}) {
  const idsInGroup = new Set(items.map((i) => i.clickupId));
  const childrenOf = (parentId: string) =>
    items.filter((i) => i.parent === parentId);
  const roots = items.filter((i) => !i.parent || !idsInGroup.has(i.parent));

  return (
    <div>
      {roots.map((root) => (
        <NestedNode
          key={root.clickupId}
          node={root}
          childrenOf={childrenOf}
          onToggle={onToggle}
          onStatusChange={onStatusChange}
          depth={0}
        />
      ))}
    </div>
  );
}

/** Nodo recursivo del árbol de nuevas. */
function NestedNode({
  node,
  childrenOf,
  onToggle,
  onStatusChange,
  depth,
}: {
  node: NewItem;
  childrenOf: (parentId: string) => NewItem[];
  onToggle: (id: string) => void;
  onStatusChange: (id: string, status: Status) => void;
  depth: number;
}) {
  const kids = childrenOf(node.clickupId);
  return (
    <div>
      <div style={{ paddingLeft: `${depth * 14}px` }}>
        <DiffRow
          type="new"
          selected={node.selected}
          onToggle={() => onToggle(node.clickupId)}
          title={node.name}
          subtitle={depth === 0 ? "raíz" : "subtarea"}
          status={node.status}
          onStatusChange={(s) => onStatusChange(node.clickupId, s)}
          hasChildren={kids.length > 0}
        />
      </div>
      {kids.map((kid) => (
        <NestedNode
          key={kid.clickupId}
          node={kid}
          childrenOf={childrenOf}
          onToggle={onToggle}
          onStatusChange={onStatusChange}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

/** Fila individual de tarea (nueva o cambio de estado). */
function DiffRow({
  type,
  selected,
  onToggle,
  title,
  subtitle,
  status,
  onStatusChange,
  hasChildren,
}: {
  type: "new" | "change";
  selected: boolean;
  onToggle: () => void;
  title: string;
  subtitle: string;
  status: Status;
  onStatusChange: (s: Status) => void;
  hasChildren?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded px-1.5 py-1.5 transition-colors",
        selected ? "hover:bg-panel2" : "opacity-50 hover:bg-panel2",
      )}
    >
      <Checkbox checked={selected} onChange={onToggle} />
      {hasChildren && (
        <CornerDownRight className="h-3 w-3 shrink-0 text-faint" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium text-ink">{title}</p>
          {type === "new" ? (
            <span className="shrink-0 rounded bg-accent/15 px-1 py-0.5 text-[9px] font-bold uppercase text-accent">
              nueva
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-bold uppercase text-amber-600 dark:text-amber-400">
              <ArrowRight className="h-2.5 w-2.5" />
              estado
            </span>
          )}
        </div>
        <p className="truncate text-[11px] text-mute">{subtitle}</p>
      </div>
      <select
        value={status}
        onChange={(e) => onStatusChange(e.target.value as Status)}
        disabled={!selected}
        className="input w-auto shrink-0 py-1 text-xs"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_META[s].label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Checkbox custom accesible. */
function Checkbox({
  checked,
  onChange,
}: {
  checked: boolean;
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
        checked
          ? "border-accent bg-accent text-acfg"
          : "border-line bg-panel hover:border-mute",
      )}
      aria-pressed={checked}
    >
      {checked && <Check className="h-3 w-3" />}
    </button>
  );
}
