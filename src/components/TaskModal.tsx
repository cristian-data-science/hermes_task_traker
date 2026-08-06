import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { X, Plus, Trash2, Loader2, Check, ExternalLink, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";
import type { Doc } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import {
  AREAS,
  STATUSES,
  AREA_META,
  STATUS_META,
  EXECUTORS,
  EXECUTOR_META,
  type Area,
  type Status,
  type Executor,
} from "../lib/constants";
import { cn } from "../lib/utils";
import { SubtaskItem } from "./SubtaskItem";
import { DatePicker } from "./DatePicker";
import { ClickUpDestinationPicker } from "./ClickUpDestinationPicker";
import { useAuth } from "../hooks/useAuth";

interface TaskModalProps {
  task?: Doc<"tasks"> | null; // si viene, es edición; si no, crear
  open: boolean;
  onClose: () => void;
  /** Estado/área por defecto al crear (opcional). */
  defaultStatus?: Status;
  defaultArea?: Area;
  /** Áreas ocultas (no se muestran en el selector al crear). */
  hiddenAreas?: string[];
}

export function TaskModal({
  task,
  open,
  onClose,
  defaultStatus = "pendiente",
  defaultArea = "patagonia",
  hiddenAreas = [],
}: TaskModalProps) {
  const isEdit = !!task;
  // Áreas visibles en el selector: las ocultas no aparecen al crear. Al editar
  // una tarea de un área oculta, la seguimos mostrando para no perder el dato.
  const visibleAreas = AREAS.filter(
    (a) => isEdit || !hiddenAreas.includes(a),
  );
  const { token } = useAuth();
  const createTask = useMutation(api.tasks.create);
  const updateTask = useMutation(api.tasks.update);
  const removeTask = useMutation(api.tasks.remove);

  // Sub-tareas
  const subtasks = useQuery(
    api.subtasks.listByTask,
    task ? { taskId: task._id, sessionToken: token! } : "skip",
  );
  const createSub = useMutation(api.subtasks.create);
  const toggleSub = useMutation(api.subtasks.toggle);
  const removeSub = useMutation(api.subtasks.remove);
  const reorderSub = useMutation(api.subtasks.reorder);

  // Sensores para el drag de sub-tareas (activación por desplazamiento
  // para no interferir con el click del checkbox/eliminar).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Estado del form
  const [title, setTitle] = useState("");
  // Si el área por defecto está oculta, caer a la primera visible.
  const [area, setArea] = useState<Area>(
    hiddenAreas.includes(defaultArea)
      ? (visibleAreas[0] ?? defaultArea)
      : defaultArea,
  );
  const [status, setStatus] = useState<Status>(defaultStatus);
  const [executor, setExecutor] = useState<Executor>("cris");
  const [notes, setNotes] = useState("");
  const [estimate, setEstimate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [progress, setProgress] = useState<number | "">("");
  const [standbyFrom, setStandbyFrom] = useState("");
  const [standbyUntil, setStandbyUntil] = useState("");
  const [scheduledDates, setScheduledDates] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [saving, setSaving] = useState(false);
  const [newSub, setNewSub] = useState("");
  const [clickupParentId, setClickupParentId] = useState<string | undefined>(
    undefined,
  );
  const [clickupListId, setClickupListId] = useState<string | undefined>(
    undefined,
  );

  // Cargar datos solo cuando CAMBIA el contexto (otra tarea, o editar↔nueva),
  // no cada vez que se reabre el modal. Así, si lo cerrás por misclic mientras
  // escribías y lo volvés a abrir, lo que tenías sigue ahí.
  // Clave de contexto: task id (o "new" si es creación) + defaults.
  const ctxKey = task ? task._id : `new:${defaultArea}:${defaultStatus}`;
  const lastCtx = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    // Si el contexto no cambió (reapertura del mismo modal tras un misclic),
    // conservar el borrador tal cual está.
    if (lastCtx.current === ctxKey) return;
    lastCtx.current = ctxKey;
    if (task) {
      setTitle(task.title);
      setArea(task.area);
      setStatus(task.status);
      setExecutor(task.executor ?? "cris");
      setNotes(task.notes ?? "");
      setEstimate(task.estimate ?? "");
      setDueDate(task.dueDate ?? "");
      setProgress(task.progress ?? "");
      setStandbyFrom(task.standbyFrom ?? "");
      setStandbyUntil(task.standbyUntil ?? "");
      setScheduledDates(task.scheduledDates ?? "");
      setRequestedBy(task.requestedBy ?? "");
      setClickupParentId(task.clickupParentId);
      setClickupListId(task.clickupListId);
    } else {
      setTitle("");
      setArea(
        hiddenAreas.includes(defaultArea)
          ? (visibleAreas[0] ?? defaultArea)
          : defaultArea,
      );
      setStatus(defaultStatus);
      setExecutor("cris");
      setNotes("");
      setEstimate("");
      setDueDate("");
      setProgress("");
      setStandbyFrom("");
      setStandbyUntil("");
      setScheduledDates("");
      setRequestedBy("");
      setClickupParentId(undefined);
      setClickupListId(undefined);
    }
    setNewSub("");
  }, [open, task, defaultArea, defaultStatus, ctxKey]);

  async function handleSave() {
    if (!title.trim()) {
      toast.error("El título es obligatorio");
      return;
    }
    setSaving(true);
    try {
      // Al EDITAR: mandamos los strings vacíos explícitamente (no undefined)
      // para que el backend sepa que hay que VACIAR esos campos (ej. limpiar
      // una fecha). Al CREAR: undefined para no setear campos vacíos.
      const blank = isEdit ? "" : undefined;
      const payload = {
        title: title.trim(),
        area,
        status,
        executor,
        notes: notes.trim() || blank,
        estimate: estimate.trim() || blank,
        dueDate: dueDate.trim() || blank,
        progress: progress === "" ? undefined : Number(progress),
        standbyFrom: standbyFrom.trim() || blank,
        standbyUntil: standbyUntil.trim() || blank,
        scheduledDates: scheduledDates.trim() || blank,
        requestedBy: requestedBy.trim() || blank,
        // Destino ClickUp solo aplica a Patagonia. Al EDITAR, solo mandamos
        // clickupParentId/clickupListId si cambiaron respecto al original, para
        // no pisar un destino válido si el picker no llegó a resolverlo al abrir.
        ...(area === "patagonia"
          ? {
              ...(clickupParentId !== (task?.clickupParentId ?? undefined)
                ? { clickupParentId }
                : {}),
              ...(clickupListId !== (task?.clickupListId ?? undefined)
                ? { clickupListId }
                : {}),
            }
          : isEdit && task
            ? // Si salió de Patagonia, limpiar el destino ClickUp.
              { clickupParentId: undefined, clickupListId: undefined }
            : {}),
      };
      if (isEdit && task) {
        await updateTask({ id: task._id, sessionToken: token!, ...payload });
        toast.success("Tarea actualizada");
      } else {
        await createTask({ sessionToken: token!, ...payload });
        toast.success("Tarea creada");
      }
      // Invalidar el borrador: la próxima apertura empieza limpio.
      lastCtx.current = null;
      onClose();
    } catch (err) {
      if (import.meta.env.DEV) console.error(err);
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!task) return;
    if (!confirm(`¿Eliminar "${task.title}"?`))
      return;
    setSaving(true);
    try {
      await removeTask({ id: task._id, sessionToken: token! });
      toast.success("Tarea eliminada");
      // Invalidar el borrador: la tarea ya no existe.
      lastCtx.current = null;
      onClose();
    } catch (err) {
      toast.error("No se pudo eliminar");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddSub() {
    if (!task || !newSub.trim()) return;
    await createSub({ taskId: task._id, title: newSub.trim(), sessionToken: token! });
    setNewSub("");
  }

  /** Reordena sub-tareas al soltar el drag. */
  async function handleSubDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ordered = subtasks ?? [];
    const fromIdx = ordered.findIndex((s) => s._id === active.id);
    const toIdx = ordered.findIndex((s) => s._id === over.id);
    if (fromIdx < 0 || toIdx < 0) return;
    try {
      await reorderSub({
        id: active.id as Doc<"subtasks">["_id"],
        newOrder: toIdx,
        sessionToken: token!,
      });
    } catch (err) {
      if (import.meta.env.DEV) console.error("[subtask reorder]", err);
      toast.error("No se pudo reordenar");
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
            <div className="flex items-center justify-between border-b border-line px-4 py-3.5 sm:px-5 sm:py-4">
              <h2 className="font-display text-lg font-semibold text-ink">
                {isEdit ? "Editar tarea" : "Nueva tarea"}
              </h2>
              <button
                onClick={onClose}
                className="rounded-el p-1.5 text-faint transition-colors hover:bg-panel2 hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body (scrollable) */}
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {/* Título */}
              <div className="mb-4">
                <label className="label">Título *</label>
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="¿Qué hay que hacer?"
                  className="input text-base"
                />
              </div>

              {/* Área + Estado + Ejecutor */}
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="label">Área</label>
                  <div
                    className="grid gap-1"
                    style={{ gridTemplateColumns: `repeat(${visibleAreas.length}, minmax(0, 1fr))` }}
                  >
                    {visibleAreas.map((a) => {
                      const meta = AREA_META[a];
                      const active = area === a;
                      return (
                        <button
                          key={a}
                          type="button"
                          onClick={() => setArea(a)}
                          style={
                            {
                              "--tone": meta.tone,
                              ...(active
                                ? {
                                    borderColor: "var(--tone)",
                                    background:
                                      "color-mix(in srgb, var(--tone) 12%, transparent)",
                                  }
                                : {}),
                            } as CSSProperties
                          }
                          className={cn(
                            "flex flex-col items-center gap-1 rounded-el border-el px-2 py-2 text-xs font-medium transition-all",
                            active
                              ? "text-ink"
                              : "border-line text-mute hover:bg-panel2",
                          )}
                        >
                          <meta.Icon
                            className="h-4 w-4"
                            style={active ? { color: "var(--tone)" } : undefined}
                          />
                          {meta.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="label">Estado</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Status)}
                    className="input"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_META[s].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Ejecutor</label>
                  <div className="relative">
                    {(() => {
                      const ExecIcon = EXECUTOR_META[executor].Icon;
                      return (
                        <ExecIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
                      );
                    })()}
                    <select
                      value={executor}
                      onChange={(e) => setExecutor(e.target.value as Executor)}
                      className="input pl-9"
                    >
                      {EXECUTORS.map((ex) => (
                        <option key={ex} value={ex}>
                          {EXECUTOR_META[ex].label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Destino ClickUp (solo Patagonia) */}
              {area === "patagonia" && (
                <div className="mb-4">
                  <ClickUpDestinationPicker
                    value={clickupParentId}
                    listId={clickupListId}
                    onChange={(parentId, lid) => {
                      setClickupParentId(parentId);
                      setClickupListId(lid);
                    }}
                  />
                  {/* Estado de sync / link si la tarea ya está sincronizada */}
                  {isEdit && task?.clickupUrl && (
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      {task.clickupSyncError ? (
                        <span className="inline-flex items-center gap-1 text-danger">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Error de sync: {task.clickupSyncError}
                        </span>
                      ) : (
                        <a
                          href={task.clickupUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-accent hover:underline"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Ver en ClickUp
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Sub-tareas (solo en edición) */}
              {isEdit && (
                <div className="mb-4">
                  <label className="label">Sub-tareas</label>
                  <div className="space-y-1.5">
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleSubDragEnd}
                    >
                      <SortableContext
                        items={(subtasks ?? []).map((s) => s._id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {(subtasks ?? []).map((s) => (
                          <SubtaskItem
                            key={s._id}
                            subtask={s}
                            onToggle={(id) => toggleSub({ id, sessionToken: token! })}
                            onRemove={(id) => removeSub({ id, sessionToken: token! })}
                          />
                        ))}
                      </SortableContext>
                    </DndContext>
                    <div className="flex gap-1.5">
                      <input
                        value={newSub}
                        onChange={(e) => setNewSub(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddSub();
                          }
                        }}
                        placeholder="Añadir sub-tarea y Enter…"
                        className="input flex-1 py-1.5 text-sm"
                      />
                      <button
                        type="button"
                        onClick={handleAddSub}
                        disabled={!newSub.trim()}
                        className="btn-secondary px-2.5"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Notas */}
              <div className="mb-4">
                <label className="label">Notas</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Detalles, criterios, contexto…"
                  rows={3}
                  className="input resize-none"
                />
              </div>

              {/* Estimación + Fecha entrega */}
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Estimación</label>
                  <input
                    value={estimate}
                    onChange={(e) => setEstimate(e.target.value)}
                    placeholder="30 min, ~4 h…"
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Fecha de entrega</label>
                  <DatePicker
                    value={dueDate}
                    onChange={setDueDate}
                    placeholder="2026-07-29, mañana…"
                    label="Calendario de fecha de entrega"
                  />
                </div>
              </div>

              {/* Progreso + Solicitado por */}
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Progreso (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={progress}
                    onChange={(e) =>
                      setProgress(e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="0–100"
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Solicitado por</label>
                  <input
                    value={requestedBy}
                    onChange={(e) => setRequestedBy(e.target.value)}
                    placeholder="Persona / equipo"
                    className="input"
                  />
                </div>
              </div>

              {/* Standby (condicional) */}
              {(status === "standby" || standbyFrom || standbyUntil) && (
                <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">Standby desde</label>
                    <DatePicker
                      value={standbyFrom}
                      onChange={setStandbyFrom}
                      placeholder="08-jul-2026"
                      label="Calendario de standby desde"
                    />
                  </div>
                  <div>
                    <label className="label">Pasa a pendiente el</label>
                    <DatePicker
                      value={standbyUntil}
                      onChange={setStandbyUntil}
                      placeholder="29-jul-2026"
                      label="Calendario de pasa a pendiente el"
                    />
                  </div>
                </div>
              )}

              {/* Programado (condicional) */}
              {(status === "programado" || scheduledDates) && (
                <div className="mb-4">
                  <label className="label">Fechas programadas</label>
                  <input
                    value={scheduledDates}
                    onChange={(e) => setScheduledDates(e.target.value)}
                    placeholder="29 y 30 de julio 2026"
                    className="input"
                  />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
              <div>
                {isEdit && (
                  <button
                    onClick={handleDelete}
                    disabled={saving}
                    className="btn-ghost text-danger hover:bg-panel2"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="hidden sm:inline">Eliminar</span>
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={onClose} className="btn-secondary">
                  Cancelar
                </button>
                <button onClick={handleSave} disabled={saving} className="btn-primary">
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  {isEdit ? "Guardar" : "Crear tarea"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
