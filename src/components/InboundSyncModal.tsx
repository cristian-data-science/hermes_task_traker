import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAction } from "convex/react";
import {
  X,
  Loader2,
  RefreshCw,
  CheckCircle2,
  Inbox,
  ArrowRight,
  Ban,
  Check,
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

/** Item nuevo mostrado en el modal (de la diff + estado UI local). */
interface NewItem {
  clickupId: string;
  name: string;
  parent: string | null;
  destinationLabel: string;
  selected: boolean;
  status: Status;
}

/** Item de cambio de estado mostrado en el modal. */
interface ChangeItem {
  taskId: string;
  clickupId: string;
  name: string;
  currentStatus: Status;
  clickupStatus: string;
  selected: boolean;
  status: Status;
}

/**
 * Modal de sincronización reversa (ClickUp → Hermes).
 *
 * Al abrir: llama a getInboundDiff, muestra spinner, luego dos secciones
 * (Nuevas / Cambios de estado) con checkboxes por ítem y selector de estado
 * Hermes destino (default = mapeo inverso, editable).
 *
 * Acciones bulk por sección + "ignorar" (marca clickupInboundIgnored).
 * Footer: "Aplicar N seleccionadas" → submitInbound.
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

  // Cargar la diff al abrir el modal.
  useEffect(() => {
    if (!open || !token) return;
    let cancelled = false;
    setLoading(true);
    setScanned(false);
    getDiff({ sessionToken: token })
      .then((diff) => {
        if (cancelled) return;
        setNewItems(
          (diff.newTasks ?? []).map((t) => ({
            clickupId: t.clickupId,
            name: t.name,
            parent: t.parent,
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

  const totalSelected =
    newItems.filter((i) => i.selected).length +
    changeItems.filter((i) => i.selected).length;
  const totalIgnored = newItems.filter((i) => !i.selected).length;

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
  function selectAllNew(v: boolean) {
    setNewItems((items) => items.map((i) => ({ ...i, selected: v })));
  }
  function selectAllChanges(v: boolean) {
    setChangeItems((items) => items.map((i) => ({ ...i, selected: v })));
  }

  async function handleApply() {
    if (!token) return;
    setApplying(true);
    try {
      const result = await submit({
        sessionToken: token,
        newTasks: newItems
          .filter((i) => i.selected)
          .map((i) => ({
            clickupId: i.clickupId,
            name: i.name,
            status: i.status,
            parent: i.parent ?? undefined,
          })),
        statusChanges: changeItems
          .filter((i) => i.selected)
          .map((i) => ({ taskId: i.taskId as any, status: i.status })),
        // Las no seleccionadas se marcan como ignoradas para que no reaparezcan.
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
                <div className="space-y-5">
                  {/* Sección: Nuevas */}
                  {newItems.length > 0 && (
                    <section>
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                          <Inbox className="h-4 w-4" />
                          Nuevas ({newItems.length})
                        </h3>
                        <div className="flex gap-1 text-[11px]">
                          <button
                            onClick={() => selectAllNew(true)}
                            className="text-accent hover:underline"
                          >
                            todas
                          </button>
                          <span className="text-faint">·</span>
                          <button
                            onClick={() => selectAllNew(false)}
                            className="text-mute hover:underline"
                          >
                            ninguna
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {newItems.map((item) => (
                          <DiffRow
                            key={item.clickupId}
                            selected={item.selected}
                            onToggle={() => toggleNew(item.clickupId)}
                            title={item.name}
                            subtitle={item.destinationLabel}
                            status={item.status}
                            onStatusChange={(s) => setNewStatus(item.clickupId, s)}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Sección: Cambios de estado */}
                  {changeItems.length > 0 && (
                    <section>
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                          <ArrowRight className="h-4 w-4" />
                          Cambios de estado ({changeItems.length})
                        </h3>
                        <div className="flex gap-1 text-[11px]">
                          <button
                            onClick={() => selectAllChanges(true)}
                            className="text-accent hover:underline"
                          >
                            todas
                          </button>
                          <span className="text-faint">·</span>
                          <button
                            onClick={() => selectAllChanges(false)}
                            className="text-mute hover:underline"
                          >
                            ninguna
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {changeItems.map((item) => (
                          <DiffRow
                            key={item.taskId}
                            selected={item.selected}
                            onToggle={() => toggleChange(item.taskId)}
                            title={item.name}
                            subtitle={`${STATUS_META[item.currentStatus].label} → ClickUp: ${item.clickupStatus}`}
                            status={item.status}
                            onStatusChange={(s) =>
                              setChangeStatus(item.taskId, s)
                            }
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  {totalIgnored > 0 && (
                    <p className="flex items-center gap-1 text-[11px] text-faint">
                      <Ban className="h-3 w-3" />
                      {totalIgnored} no seleccionada
                      {totalIgnored !== 1 ? "s" : ""} se marcará
                      {totalIgnored !== 1 ? "n" : ""} como ignorada
                      {totalIgnored !== 1 ? "s" : ""} (no reaparecerá
                      {totalIgnored !== 1 ? "n" : ""})
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

/** Fila individual de la diff: checkbox + info + selector de estado. */
function DiffRow({
  selected,
  onToggle,
  title,
  subtitle,
  status,
  onStatusChange,
}: {
  selected: boolean;
  onToggle: () => void;
  title: string;
  subtitle: string;
  status: Status;
  onStatusChange: (s: Status) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-el border-el p-2.5 transition-colors",
        selected ? "border-line bg-panel2" : "border-line opacity-60",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "grid h-5 w-5 shrink-0 place-items-center rounded border-el transition-colors",
          selected
            ? "border-accent bg-accent text-acfg"
            : "border-line bg-panel hover:border-mute",
        )}
        aria-pressed={selected}
      >
        {selected && <Check className="h-3.5 w-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{title}</p>
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
