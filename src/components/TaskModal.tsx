import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Plus,
  Trash2,
  Loader2,
  Check,
  GripVertical,
} from "lucide-react";
import toast from "react-hot-toast";
import type { Doc } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import {
  AREAS,
  STATUSES,
  AREA_META,
  STATUS_META,
  type Area,
  type Status,
} from "../lib/constants";
import { cn } from "../lib/utils";

interface TaskModalProps {
  task?: Doc<"tasks"> | null; // si viene, es edición; si no, crear
  open: boolean;
  onClose: () => void;
  /** Estado/área por defecto al crear (opcional). */
  defaultStatus?: Status;
  defaultArea?: Area;
}

export function TaskModal({
  task,
  open,
  onClose,
  defaultStatus = "pendiente",
  defaultArea = "personal",
}: TaskModalProps) {
  const isEdit = !!task;
  const createTask = useMutation(api.tasks.create);
  const updateTask = useMutation(api.tasks.update);
  const removeTask = useMutation(api.tasks.remove);

  // Sub-tareas
  const subtasks = useQuery(
    api.subtasks.listByTask,
    task ? { taskId: task._id } : "skip",
  );
  const createSub = useMutation(api.subtasks.create);
  const toggleSub = useMutation(api.subtasks.toggle);
  const removeSub = useMutation(api.subtasks.remove);

  // Estado del form
  const [title, setTitle] = useState("");
  const [area, setArea] = useState<Area>(defaultArea);
  const [status, setStatus] = useState<Status>(defaultStatus);
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

  // Cargar datos cuando se abre
  useEffect(() => {
    if (!open) return;
    if (task) {
      setTitle(task.title);
      setArea(task.area);
      setStatus(task.status);
      setNotes(task.notes ?? "");
      setEstimate(task.estimate ?? "");
      setDueDate(task.dueDate ?? "");
      setProgress(task.progress ?? "");
      setStandbyFrom(task.standbyFrom ?? "");
      setStandbyUntil(task.standbyUntil ?? "");
      setScheduledDates(task.scheduledDates ?? "");
      setRequestedBy(task.requestedBy ?? "");
    } else {
      setTitle("");
      setArea(defaultArea);
      setStatus(defaultStatus);
      setNotes("");
      setEstimate("");
      setDueDate("");
      setProgress("");
      setStandbyFrom("");
      setStandbyUntil("");
      setScheduledDates("");
      setRequestedBy("");
    }
    setNewSub("");
  }, [open, task, defaultArea, defaultStatus]);

  async function handleSave() {
    if (!title.trim()) {
      toast.error("El título es obligatorio");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        area,
        status,
        notes: notes.trim() || undefined,
        estimate: estimate.trim() || undefined,
        dueDate: dueDate.trim() || undefined,
        progress: progress === "" ? undefined : Number(progress),
        standbyFrom: standbyFrom.trim() || undefined,
        standbyUntil: standbyUntil.trim() || undefined,
        scheduledDates: scheduledDates.trim() || undefined,
        requestedBy: requestedBy.trim() || undefined,
      };
      if (isEdit && task) {
        await updateTask({ id: task._id, ...payload });
        toast.success("Tarea actualizada");
      } else {
        await createTask(payload);
        toast.success("Tarea creada 🎉");
      }
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!task) return;
    if (!confirm(`¿Eliminar "${task.title}"? Esta acción no se puede deshacer.`))
      return;
    setSaving(true);
    try {
      await removeTask({ id: task._id });
      toast.success("Tarea eliminada");
      onClose();
    } catch (err) {
      toast.error("No se pudo eliminar");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddSub() {
    if (!task || !newSub.trim()) return;
    await createSub({ taskId: task._id, title: newSub.trim() });
    setNewSub("");
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:rounded-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                {isEdit ? "Editar tarea" : "Nueva tarea"}
              </h2>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body (scrollable) */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
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

              {/* Área + Estado */}
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Área</label>
                  <div className="grid grid-cols-3 gap-1">
                    {AREAS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setArea(a)}
                        className={cn(
                          "rounded-lg border px-2 py-2 text-xs font-medium transition-all",
                          area === a
                            ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800",
                        )}
                      >
                        <div className="text-base">{AREA_META[a].emoji}</div>
                        {AREA_META[a].label}
                      </button>
                    ))}
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
                        {STATUS_META[s].emoji} {STATUS_META[s].label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Sub-tareas (solo en edición) */}
              {isEdit && (
                <div className="mb-4">
                  <label className="label">Sub-tareas</label>
                  <div className="space-y-1.5">
                    {subtasks?.map((s) => (
                      <div
                        key={s._id}
                        className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 dark:border-slate-700"
                      >
                        <GripVertical className="h-3.5 w-3.5 text-slate-300" />
                        <button
                          onClick={() => toggleSub({ id: s._id })}
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all",
                            s.done
                              ? "border-emerald-500 bg-emerald-500 text-white"
                              : "border-slate-300 dark:border-slate-600",
                          )}
                        >
                          {s.done && <Check className="h-3 w-3" strokeWidth={3} />}
                        </button>
                        <span
                          className={cn(
                            "flex-1 text-sm",
                            s.done && "text-slate-400 line-through",
                          )}
                        >
                          {s.title}
                        </span>
                        <button
                          onClick={() => removeSub({ id: s._id })}
                          className="text-slate-300 hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
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
              <div className="mb-4 grid grid-cols-2 gap-3">
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
                  <input
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    placeholder="2026-07-29, mañana…"
                    className="input"
                  />
                </div>
              </div>

              {/* Progreso + Solicitado por */}
              <div className="mb-4 grid grid-cols-2 gap-3">
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
                <div className="mb-4 grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Standby desde</label>
                    <input
                      value={standbyFrom}
                      onChange={(e) => setStandbyFrom(e.target.value)}
                      placeholder="08-jul-2026"
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label">Pasa a pendiente el</label>
                    <input
                      value={standbyUntil}
                      onChange={(e) => setStandbyUntil(e.target.value)}
                      placeholder="29-jul-2026"
                      className="input"
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
            <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
              <div>
                {isEdit && (
                  <button
                    onClick={handleDelete}
                    disabled={saving}
                    className="btn-ghost text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    <Trash2 className="h-4 w-4" />
                    Eliminar
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
