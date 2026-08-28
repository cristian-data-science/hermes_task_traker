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
import {
  X,
  Plus,
  Trash2,
  Loader2,
  Check,
  ExternalLink,
  AlertTriangle,
  Unlink,
  Maximize2,
  Minimize2,
} from "lucide-react";
import toast from "react-hot-toast";
import type { Doc } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import { CatchupNoteField } from "./CatchupPinButton";
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
import { isMobileLike } from "../hooks/usePwaInstall";

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
  const detachFromClickup = useMutation(api.tasks.detachFromClickup);

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
  // Cuadro de notas expandido: preferencia persistente entre sesiones.
  const [notesExpanded, setNotesExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem("hermes-notes-expanded") === "1";
    } catch {
      return false;
    }
  });
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
  const [clickupLocal, setClickupLocal] = useState<boolean>(false);
  const [clickupListId, setClickupListId] = useState<string | undefined>(
    undefined,
  );

  // Cargar datos solo cuando CAMBIA el contexto (otra tarea, o editar↔nueva),
  // no cada vez que se reabre el modal. Así, si lo cerrás por misclic mientras
  // escribías y lo volvés a abrir, lo que tenías sigue ahí.
  // Clave de contexto: task id (o "new" si es creación) + defaults.
  const ctxKey = task ? task._id : `new:${defaultArea}:${defaultStatus}`;
  const lastCtx = useRef<string | null>(null);
  // Marca de hidratación: hasta que el estado local no refleja la tarea, NO
  // montamos el ClickUpDestinationPicker. El picker fija su modo (Mesa/Proyecto)
  // una sola vez al montar, así que montarlo antes de tiempo lo dejaría en
  // "Mesa Técnica" aunque la tarea tenga destino de proyecto.
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    // Si el contexto no cambió (reapertura del mismo modal tras un misclic),
    // conservar el borrador tal cual está.
    if (lastCtx.current === ctxKey) {
      setHydratedKey(ctxKey);
      return;
    }
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
      setClickupLocal(task.clickupLocal ?? false);
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
      setClickupLocal(false);
    }
    setNewSub("");
    setHydratedKey(ctxKey);
  }, [open, task, defaultArea, defaultStatus, ctxKey]);

  async function handleSave() {
    if (!title.trim()) {
      toast.error("El título es obligatorio");
      return;
    }
    setSaving(true);
    try {
      // ¿Cambió el destino ClickUp respecto al guardado? (parent o list)
      const destinationChanged =
        clickupParentId !== (task?.clickupParentId ?? undefined) ||
        clickupListId !== (task?.clickupListId ?? undefined);
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
        // Destino ClickUp: solo aplica a Patagonia.
        // Al EDITAR mandamos los dos campos SOLO si el destino cambió, y usamos
        // "" (no undefined) para decir "sin destino": Convex descarta los
        // undefined al serializar, así que un undefined explícito nunca llegaba
        // al backend y el destino viejo quedaba pegado. Si no cambió, no
        // mandamos nada, para no pisar un destino válido cuando el picker no
        // llegó a resolverlo al abrir.
        ...(area === "patagonia"
          ? {
              clickupLocal,
              ...(isEdit
                ? destinationChanged
                  ? {
                      clickupParentId: clickupParentId ?? "",
                      clickupListId: clickupListId ?? "",
                    }
                  : {}
                : {
                    // Al CREAR: omitir vacíos para no persistir strings vacíos.
                    ...(clickupParentId ? { clickupParentId } : {}),
                    ...(clickupListId ? { clickupListId } : {}),
                  }),
            }
          : isEdit && task
            ? // Si salió de Patagonia, limpiar el destino ClickUp.
              { clickupParentId: "", clickupListId: "" }
            : {}),
      };
      if (isEdit && task) {
        await updateTask({ id: task._id, sessionToken: token!, ...payload });
        toast.success("Tarea actualizada");
      } else {
        await createTask({ sessionToken: token!, ...payload });
        toast.success("Tarea creada");
      }
      // Invalidar el borrador: la próxima apertura empieza limpio (y el picker
      // se re-monta recién cuando el estado esté hidratado de nuevo).
      lastCtx.current = null;
      setHydratedKey(null);
      onClose();
    } catch (err) {
      if (import.meta.env.DEV) console.error(err);
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Corta la conexión con ClickUp: la tarea se queda en el tablero pero deja
   * de sincronizarse, y a partir de acá eliminarla NO la borra en ClickUp.
   * No manda nada a ClickUp: allá queda intacta.
   */
  async function handleDetach() {
    if (!task?.clickupId) return;
    if (
      !confirm(
        `¿Desvincular "${task.title}" de ClickUp?\n\n` +
          `• La tarea sigue en el Kanban, pero deja de sincronizarse.\n` +
          `• En ClickUp NO se toca nada: queda tal cual está.\n` +
          `• A partir de ahora, eliminarla acá NO la borra en ClickUp.\n\n` +
          `Para volver a vincularla habría que importarla de nuevo.`,
      )
    )
      return;
    setSaving(true);
    try {
      await detachFromClickup({ id: task._id, sessionToken: token! });
      toast.success("Desvinculada de ClickUp");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo desvincular",
      );
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
      setHydratedKey(null);
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
                {/* En teléfono el teclado NO se abre solo: solo al tocar una
                    caja de texto. Desktop conserva el autofocus. */}
                <input
                  autoFocus={!isMobileLike()}
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
                  {/* Check "solo local": la tarea vive únicamente en Hermes y
                      nunca se crea en ClickUp. */}
                  <button
                    type="button"
                    onClick={() => setClickupLocal((v) => !v)}
                    className={cn(
                      "mb-2 flex w-full items-center gap-2.5 rounded-el border-el px-2.5 py-2 text-left transition-colors",
                      clickupLocal
                        ? "border-accent/50 bg-accent/5"
                        : "border-line hover:bg-panel2",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-4 w-4 shrink-0 place-items-center rounded border-el transition-colors",
                        clickupLocal
                          ? "border-accent bg-accent text-acfg"
                          : "border-line bg-panel",
                      )}
                    >
                      {clickupLocal && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-ink">
                        Solo local
                      </span>
                      <span className="block text-[10px] text-faint">
                        Vive únicamente en Hermes: no se crea ni sincroniza con
                        ClickUp
                        {isEdit && task?.clickupId
                          ? " (se desvinculará; la copia en ClickUp queda)"
                          : ""}
                      </span>
                    </span>
                  </button>

                  {clickupLocal ? (
                    <div className="rounded-el border-el border-line bg-panel px-3 py-2.5 text-xs text-mute">
                      Esta tarea quedará solo en Convex con el badge{" "}
                      <span className="font-medium text-mute">Local</span>.
                    </div>
                  ) : (
                    hydratedKey === ctxKey && (
                    <ClickUpDestinationPicker
                      // Remount limpio al cambiar de tarea (o nueva↔edición).
                      // El picker fija su estado de navegación una sola vez al
                      // montar; el key + el guard de hidratación garantizan que
                      // monte con el destino correcto de ESTA tarea.
                      key={ctxKey}
                      value={clickupParentId}
                      listId={clickupListId}
                      // Fuente de verdad para ubicar la tarea en ClickUp.
                      taskClickupId={task?.clickupId}
                      onChange={(parentId, lid) => {
                        setClickupParentId(parentId);
                        setClickupListId(lid);
                      }}
                    />
                  )
                  )}
                  {/* Estado de sync / link. Se muestra también SIN clickupUrl:
                      una creación en ClickUp que falló no tiene URL, y antes
                      el error quedaba invisible (la tarea parecía "Local"). */}
                  {isEdit && (task?.clickupUrl || task?.clickupSyncError) && (
                    <div className="mt-2 flex flex-col gap-0.5 text-xs">
                      {task.clickupSyncError ? (
                        <>
                          <span
                            className="inline-flex items-center gap-1 text-danger"
                            title={task.clickupSyncError}
                          >
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            <span className="min-w-0 break-words">
                              Error de sync:{" "}
                              {task.clickupSyncError.length > 140
                                ? `${task.clickupSyncError.slice(0, 140)}…`
                                : task.clickupSyncError}
                            </span>
                          </span>
                          {!task.clickupId && (
                            <span className="pl-5 text-[10px] text-faint">
                              No llegó a crearse en ClickUp. Se reintenta al
                              volver a guardar la tarea.
                            </span>
                          )}
                        </>
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

              {/* Pin de catch-up: solo al editar una tarea existente, porque
                  necesita un id para persistir la marca. */}
              {task && <CatchupNoteField task={task} />}

              {/* Notas. El textarea se puede expandir (preferencia persistida
                  en localStorage) para releer cómodamente textos largos sin
                  depender del mini-scroll interno. */}
              <div className="mb-4">
                <div className="flex items-center justify-between">
                  <label className="label">Notas</label>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !notesExpanded;
                      setNotesExpanded(next);
                      try {
                        localStorage.setItem(
                          "hermes-notes-expanded",
                          next ? "1" : "0",
                        );
                      } catch {
                        // localStorage lleno/bloqueado: la preferencia es
                        // cosmética, no vale romper el modal por ella.
                      }
                    }}
                    title={
                      notesExpanded
                        ? "Contraer el cuadro de notas"
                        : "Expandir el cuadro de notas"
                    }
                    className="mb-1 inline-flex items-center gap-1 text-[10px] font-medium text-mute transition-colors hover:text-accent"
                  >
                    {notesExpanded ? (
                      <Minimize2 className="h-3 w-3" />
                    ) : (
                      <Maximize2 className="h-3 w-3" />
                    )}
                    {notesExpanded ? "Contraer" : "Expandir"}
                  </button>
                </div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Detalles, criterios, contexto…"
                  rows={notesExpanded ? 16 : 3}
                  className="input resize-y transition-[height] duration-150"
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
              <div className="flex items-center gap-1">
                {isEdit && task?.clickupId && !task.clickupDetached && (
                  <button
                    onClick={handleDetach}
                    disabled={saving}
                    title="Corta la conexión con ClickUp. La tarea sigue en el tablero; allá no se toca nada. Después, eliminarla acá ya no la borra en ClickUp."
                    className="btn-ghost text-mute hover:bg-panel2 hover:text-ink"
                  >
                    <Unlink className="h-4 w-4" />
                    <span className="hidden sm:inline">
                      Desvincular de ClickUp
                    </span>
                  </button>
                )}
                {isEdit && (
                  <button
                    onClick={handleDelete}
                    disabled={saving}
                    className="btn-ghost text-danger hover:bg-panel2"
                    title={
                      task?.clickupId && !task.clickupDetached
                        ? "Elimina la tarea acá Y en ClickUp"
                        : "Elimina la tarea solo del tablero"
                    }
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
