/**
 * Panel de delegación de una tarea (executor=zcode): timeline de corridas con
 * resúmenes/evidencia, respuesta a preguntas, aprobación/rechazo y cancelación.
 * Se abre desde la tarjeta (web) o desde la vista Agente.
 */
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, CornerDownRight, Check, Ban, Send, Loader2, Copy, Trash2, Shuffle, FolderOpen, FileText,
  ExternalLink, MessageCircle,
} from "lucide-react";
import toast from "react-hot-toast";
import type { Doc } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import { useAuth } from "../hooks/useAuth";
import {
  AGENT_STATE_META,
  AUTONOMY_META,
  TASK_TYPE_META,
  type AgentState,
  type Autonomy,
  type TaskType,
} from "../lib/constants";
import { cn, formatRelative, formatAgo } from "../lib/utils";

function RunStateChip({ state }: { state: string }) {
  const meta = AGENT_STATE_META[state as AgentState];
  if (!meta) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border-el px-1.5 py-0.5 text-[10px] font-semibold",
        meta.pulse && "animate-pulse",
      )}
      style={{
        color: meta.tone,
        borderColor: `color-mix(in srgb, ${meta.tone} 45%, transparent)`,
        background: `color-mix(in srgb, ${meta.tone} 10%, transparent)`,
      }}
    >
      <meta.Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

/** Botones de artefactos: abrir carpeta / abrir reporte (.md) / ver en ClickUp.
 *  La web no puede abrir rutas locales por seguridad → protocolo
 *  hermesagent:// (instalado en el PC de Cris por agent-bridge). */
function ArtifactsBlock({
  task,
  plan,
}: {
  task: Doc<"tasks">;
  /** Plan de la última corrida (para el sidebar del chat). */
  plan?: string[];
}) {
  if (!task.workspacePath) return null;
  const open = (mode: "open" | "file" | "md", path: string) => {
    window.location.href = `hermesagent://${mode}?path=${encodeURIComponent(path)}`;
  };
  const isReporte = task.taskType === "reporte";
  const clickupHref =
    task.clickupUrl ??
    (task.clickupId ? `https://app.clickup.com/t/${task.clickupId}` : undefined);
  return (
    <div className="mb-4 rounded-el border-el border-line bg-panel2/50 p-3">
      <label className="label mb-1.5 flex items-center gap-1.5">
        <FolderOpen className="h-3.5 w-3.5" />
        Artefactos
      </label>
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => open("open", task.workspacePath!)}
          className="btn-ghost inline-flex items-center gap-1.5 border-el text-xs hover:text-ink"
          title={`Abrir en el Explorador: ${task.workspacePath}`}
        >
          <FolderOpen className="h-3.5 w-3.5" /> Abrir carpeta
        </button>
        {clickupHref && !task.clickupDetached && (
          <a
            href={clickupHref}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost inline-flex items-center gap-1.5 border-el text-xs hover:text-ink"
            title="Abrir esta tarea en ClickUp y ver cómo quedó"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Ver en ClickUp
          </a>
        )}
        {task.agentSessionId && (
          <button
            onClick={() => {
              // Plan de la corrida más reciente + estado actual: viajan en el
              // deep link (plan en base64url) para que el chat los muestre en
              // su sidebar y le inyecte el estado fresco al agente en cada
              // pregunta (si no, respondía con recuerdos viejos tipo
              // "quedó en para-revisión" cuando ya estaba completada).
              const latestWithPlan = (plan ?? []).length
                ? { plan }
                : undefined;
              const planJson = JSON.stringify(latestWithPlan?.plan ?? []);
              const p64 = btoa(
                String.fromCharCode(...new TextEncoder().encode(planJson)),
              )
                .replace(/\+/g, "-")
                .replace(/\//g, "_")
                .replace(/=+$/, "");
              const st = task.status ?? "";
              const ag = task.agentState ?? "";
              window.location.href = `hermesagent://zcode?path=${encodeURIComponent(task.workspacePath!)}&session=${encodeURIComponent(task.agentSessionId!)}&p64=${p64}&st=${encodeURIComponent(st)}&ag=${encodeURIComponent(ag)}`;
            }}
            className="btn-ghost inline-flex items-center gap-1.5 border-el text-xs hover:text-ink"
            title="Abre una página de chat en tu navegador contra la sesión EXACTA de esta tarea: historial completo, respuesta en vivo (streaming) y el plan en la barra lateral. Tildá 'Siempre permitir' la primera vez."
          >
            <MessageCircle className="h-3.5 w-3.5" /> Chatear con el agente
          </button>
        )}
        {isReporte ? (
          <button
            onClick={() => open("file", `${task.workspacePath}\\CAMBIOS.md`)}
            className="btn-ghost inline-flex items-center gap-1.5 border-el text-xs hover:text-ink"
            title="Abrir la bitácora CAMBIOS.md del reporte (Bloc de notas)"
          >
            <FileText className="h-3.5 w-3.5" /> Ver CAMBIOS.md
          </button>
        ) : (
          <button
            onClick={() => open("md", task.workspacePath!)}
            className="btn-ghost inline-flex items-center gap-1.5 border-el text-xs hover:text-ink"
            title="Abrir el .md modificado más recientemente en esa carpeta (reporte/bitácora del agente)"
          >
            <FileText className="h-3.5 w-3.5" /> Ver reporte (.md)
          </button>
        )}
      </div>
      <p className="mt-1.5 font-mono text-[10px] text-faint">{task.workspacePath}</p>
      <p className="mt-1 text-[10px] text-faint">
        Primera vez: el navegador pedirá permiso para abrir "Hermes Agent Protocol" — acepta siempre.
      </p>
    </div>
  );
}
/** Plan declarado (roadmap) + checklist de pasos reales + actividad en vivo. */
function StepList({ run }: { run: Doc<"agentRuns"> }) {
  const steps = run.progressLog ?? [];
  const plan = run.plan ?? [];
  const open = !run.endedAt;
  const doneCount = steps.length;
  const lastLive =
    open && run.lastActivity && run.lastActivityAt
      ? { text: run.lastActivity, at: run.lastActivityAt }
      : null;
  // La actividad en vivo se muestra aparte solo si no duplica al último paso.
  const live =
    lastLive && steps[steps.length - 1]?.text !== lastLive.text ? lastLive : null;

  return (
    <div>
      {/* Roadmap: el plan declarado con la posición actual */}
      {plan.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
            Plan · paso {Math.min(doneCount + (open ? 1 : 0), plan.length) || "–"} de {plan.length}
          </p>
          <ol className="space-y-0.5">
            {plan.map((p, i) => {
              const done = i < doneCount;
              const current = open && i === doneCount;
              return (
                <li
                  key={i}
                  className={cn(
                    "flex items-baseline gap-1.5 text-[11px]",
                    current ? "font-semibold text-ink" : done ? "text-mute" : "text-faint",
                  )}
                >
                  <span
                    className={cn(
                      "shrink-0",
                      done && "text-emerald-500",
                      current && "animate-pulse text-fuchsia-600 dark:text-fuchsia-400",
                    )}
                  >
                    {done ? "✓" : current ? "▶" : "○"}
                  </span>
                  <span className="min-w-0">
                    {i + 1}. {p}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Registro real de pasos reportados */}
      {steps.length > 0 && (
        <ol className="space-y-1">
          {steps.map((s, i) => {
            const isLast = i === steps.length - 1 && !live;
            return (
              <li key={`${s.at}-${i}`} className="flex items-baseline gap-1.5 text-xs">
                <span
                  className={cn(
                    "shrink-0 font-mono text-[10px]",
                    isLast ? "text-fuchsia-600 dark:text-fuchsia-400" : "text-faint",
                  )}
                >
                  {i + 1}.
                </span>
                <span className={cn("min-w-0", isLast ? "font-medium text-ink" : "text-mute")}>
                  {s.text}
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-faint">
                  {formatAgo(s.at)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {live && (
        <p
          className={cn(
            "mt-1.5 flex items-center gap-1.5 text-xs",
            run.stalled ? "text-amber-600 dark:text-amber-400" : "text-mute",
          )}
          title={run.stalled ? "Sin actividad nueva por un rato — posible atasco" : "Actividad detectada en el transcript de la sesión"}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              run.stalled ? "bg-amber-500" : "animate-pulse bg-fuchsia-500",
            )}
          />
          <span className="min-w-0 truncate">{live.text}</span>
          <span className="ml-auto shrink-0 text-[10px] text-faint">
            {formatAgo(live.at)}
          </span>
        </p>
      )}
      {run.stalled && !live && (
        <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          ⚠ Posible atasco: sin actividad registrada por un rato. Podés cancelar
          la delegación o esperar.
        </p>
      )}
      {open && run.startedAt && (
        <p className="mt-1 text-[10px] text-faint">
          Corrida en curso · {Math.max(1, Math.round((Date.now() - run.startedAt) / 60000))} min
        </p>
      )}
    </div>
  );
}

export function AgentRunsPanel({
  task,
  open,
  onClose,
}: {
  task: Doc<"tasks"> | null;
  open: boolean;
  onClose: () => void;
}) {
  const { token } = useAuth();
  // Tarea EN VIVO: el prop llega de un snapshot de la vista; sin esto, los
  // botones quedaban pegados al estado viejo (p.ej. responder tras cancelar).
  const liveTask = useQuery(
    api.tasks.get,
    token && task ? { sessionToken: token, id: task._id } : "skip",
  );
  const t = liveTask ?? task;
  const runs =
    useQuery(
      api.agent.runsByTask,
      token && task ? { sessionToken: token, taskId: task._id } : "skip",
    ) ?? [];
  const answerQuestion = useMutation(api.agent.answerQuestion);
  const askHistory = useMutation(api.agent.askHistory);
  const reviewResult = useMutation(api.agent.reviewResult);
  const cancelAgent = useMutation(api.agent.cancelAgent);
  const removeTask = useMutation(api.tasks.remove);
  const redirectAgent = useMutation(api.agent.redirectAgent);

  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [redirect, setRedirect] = useState("");
  const [acting, setActing] = useState(false);

  if (!task || !t) return null;
  const state = (t.agentState ?? null) as AgentState | null;
  const typeMeta = t.taskType ? TASK_TYPE_META[t.taskType as TaskType] : null;
  const autoMeta = t.autonomy ? AUTONOMY_META[t.autonomy as Autonomy] : null;
  // Link a ClickUp: visible siempre que la tarea esté vinculada (cualquier
  // estado de la delegación). Desvinculada = ya no le pertenece a ClickUp.
  const clickupHref =
    t.clickupUrl ??
    (t.clickupId ? `https://app.clickup.com/t/${t.clickupId}` : undefined);

  async function act(fn: () => Promise<unknown>, okMsg: string) {
    setActing(true);
    try {
      await fn();
      toast.success(okMsg);
      setAnswer("");
      setFeedback("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falló la acción");
    } finally {
      setActing(false);
    }
  }

  const canAnswer =
    state === "pregunta" || state === "error" || state === "cancelada";
  const canReview = state === "para-revision";
  const canCancel =
    state && !["hecho", "cancelada"].includes(state);
  // Redirección en vivo: la corrida está activa y Cris quiere cambiar el rumbo
  // sin matarla. Se entrega en el próximo reporte del agente (--step/--plan).
  const canRedirect =
    state === "despachada" || state === "trabajando" || state === "pregunta";

  /** Redirección en vivo: cambia el rumbo de la corrida activa. */
  async function handleRedirect() {
    if (!task) return;
    setActing(true);
    try {
      await redirectAgent({
        sessionToken: token!,
        taskId: task._id,
        message: redirect.trim(),
      });
      toast.success("Redirección en cola — se entrega en su próximo reporte");
      setRedirect("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo redirigir");
    } finally {
      setActing(false);
    }
  }

  /** Borra la tarea: si la delegación está viva la cancela primero. */
  async function handleDelete() {
    if (!task) return;
    if (!confirm(`¿Eliminar "${task.title}" del tablero?`)) return;
    setActing(true);
    try {
      if (canCancel) {
        await cancelAgent({ sessionToken: token!, taskId: task._id }).catch(
          () => {},
        );
      }
      await removeTask({ sessionToken: token!, id: task._id });
      toast.success("Tarea eliminada");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo eliminar");
    } finally {
      setActing(false);
    }
  }

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
            className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border-el border-line bg-panel shadow-el-lg sm:rounded-el-lg"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
              <div className="min-w-0">
                <h2 className="truncate font-display text-lg font-semibold text-ink">
                  {task.title}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-mute">
                  {state && <RunStateChip state={state} />}
                  {typeMeta && <span>{typeMeta.label}</span>}
                  {autoMeta && <span>· {autoMeta.label}</span>}
                  {task.model && (
                    <span className="font-mono">· {task.model.split("/").pop()}</span>
                  )}
                  {clickupHref && !t.clickupDetached && (
                    <a
                      href={clickupHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-accent hover:underline"
                      title="Abrir esta tarea en ClickUp"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Abrir en ClickUp
                    </a>
                  )}
                </div>
              </div>
              <button
                onClick={onClose}
                className="rounded-el p-1.5 text-faint transition-colors hover:bg-panel2 hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {/* Pregunta abierta del agente */}
              {state === "pregunta" && task.agentQuestion && (
                <div className="mb-4 rounded-el border-el p-3" style={{ borderColor: "color-mix(in srgb, var(--status-urgente) 45%, transparent)", background: "color-mix(in srgb, var(--status-urgente) 8%, transparent)" }}>
                  <p className="text-xs font-semibold text-ink">El agente pregunta:</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-mute">
                    {task.agentQuestion}
                  </p>
                </div>
              )}

              {/* Redirección en vivo: cambiar el rumbo SIN matar la corrida */}
              {canRedirect && (
                <div className="mb-4 rounded-el border-el border-line bg-panel2/50 p-3">
                  <label className="label flex items-center gap-1.5">
                    <Shuffle className="h-3.5 w-3.5" />
                    Redirigir al agente en vivo
                  </label>
                  {t.agentRedirect ? (
                    <p className="rounded-el bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
                      <span className="font-semibold">Instrucción en cola de entrega:</span>{" "}
                      {t.agentRedirect}
                    </p>
                  ) : (
                    <textarea
                      value={redirect}
                      onChange={(e) => setRedirect(e.target.value)}
                      rows={2}
                      placeholder="Ej: no toques esa medida, mejor aggregate las 5 columnas al Excel y compara. / Ese camino no: usa la tabla DimX."
                      className="input resize-y font-normal text-xs"
                    />
                  )}
                  {!t.agentRedirect && (
                    <>
                      <button
                        disabled={acting || !redirect.trim()}
                        onClick={() => void handleRedirect()}
                        className="btn-primary mt-2 inline-flex items-center gap-1.5 text-xs"
                      >
                        {acting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Shuffle className="h-3.5 w-3.5" />
                        )}
                        Enviar redirección
                      </button>
                      <p className="mt-1.5 text-[10px] text-faint">
                        Se entrega al agente en su próximo reporte (los pasos
                        suelen llegar cada pocos minutos); verás su adaptación
                        en la actividad en vivo.
                      </p>
                    </>
                  )}
                </div>
              )}

              {/* Responder / re-despachar (pregunta, error o cancelada → re-encola) */}
              {canAnswer && (
                <div className="mb-4">
                  <label className="label">
                    {state === "pregunta"
                      ? "Tu respuesta"
                      : state === "cancelada"
                        ? "Nuevo intento (re-despachar)"
                        : "Qué corregir / reintentar"}
                  </label>
                  <textarea
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    rows={3}
                    placeholder={
                      state === "pregunta"
                        ? "El contexto o la decisión que le falta al agente…"
                        : state === "cancelada"
                          ? "Instrucciones para este nuevo intento…"
                          : "Instrucciones para la próxima corrida…"
                    }
                    className="input resize-y font-normal"
                  />
                  <button
                    disabled={acting || !answer.trim()}
                    onClick={() =>
                      act(
                        () =>
                          answerQuestion({
                            sessionToken: token!,
                            taskId: task._id,
                            answer: answer.trim(),
                          }),
                        "Enviado: el agente retoma con tus instrucciones",
                      )
                    }
                    className="btn-primary mt-2 inline-flex items-center gap-1.5 text-xs"
                  >
                    {acting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    {state === "cancelada" ? "Re-despachar" : "Enviar al agente"}
                  </button>
                </div>
              )}

              {/* Preguntarle al agente sobre lo ya entregado (hecho): re-despacha
                  con --resume, así que responde con el contexto de su sesión si
                  sigue viva. La respuesta llega como corrida nueva. */}
              {state === "hecho" && task.agentSessionId && (
                <div className="mb-4 rounded-el border-el border-line bg-panel2/50 p-3">
                  <label className="label flex items-center gap-1.5">
                    <MessageCircle className="h-3.5 w-3.5" />
                    Preguntarle al agente
                  </label>
                  <textarea
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    rows={3}
                    placeholder="Sobre las decisiones que tomó, el reporte, o pedile un ajuste — responde con el contexto de lo que hizo…"
                    className="input resize-y font-normal"
                  />
                  <button
                    disabled={acting || !answer.trim()}
                    onClick={() =>
                      act(
                        () =>
                          askHistory({
                            sessionToken: token!,
                            taskId: task._id,
                            question: answer.trim(),
                          }),
                        "Pregunta enviada: el agente la responde con el contexto de su sesión",
                      )
                    }
                    className="btn-primary mt-2 inline-flex items-center gap-1.5 text-xs"
                  >
                    {acting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Enviar pregunta
                  </button>
                  <p className="mt-1.5 text-[10px] text-faint">
                    Si la sesión aún vive en ZCode responde con todo el contexto;
                    si fue rotada, responde desde el reporte y los artefactos. Al
                    terminar queda en para-revisión para tu OK.
                  </p>
                </div>
              )}

              {/* Aprobar / rechazar lo que quedó para revisión */}
              {canReview && (
                <div className="mb-4 rounded-el border-el border-line bg-panel2/50 p-3">
                  <p className="text-xs font-semibold text-ink">
                    Resultado esperando tu OK
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      disabled={acting}
                      onClick={() =>
                        act(
                          () =>
                            reviewResult({
                              sessionToken: token!,
                              taskId: task._id,
                              approve: true,
                            }),
                          "Aprobado: tarea completada",
                        )
                      }
                      className="btn-primary inline-flex items-center gap-1.5 text-xs"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Aprobar
                    </button>
                    <button
                      disabled={acting || !feedback.trim()}
                      onClick={() =>
                        act(
                          () =>
                            reviewResult({
                              sessionToken: token!,
                              taskId: task._id,
                              approve: false,
                              feedback: feedback.trim(),
                            }),
                          "Rechazado: el agente reintentará con tu feedback",
                        )
                      }
                      className="btn-ghost inline-flex items-center gap-1.5 border-el text-xs hover:text-ink"
                    >
                      <CornerDownRight className="h-3.5 w-3.5" />
                      Rechazar y corregir
                    </button>
                  </div>
                  <input
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Qué corregir (obligatorio para rechazar)…"
                    className="input mt-2 text-xs"
                  />
                </div>
              )}

              {/* Cancelar delegación */}
              {canCancel && (
                <button
                  disabled={acting}
                  onClick={() => {
                    if (!confirm("¿Quitarle la tarea al agente? Vuelve al tablero como pendiente."))
                      return;
                    act(
                      () => cancelAgent({ sessionToken: token!, taskId: task._id }),
                      "Delegación cancelada",
                    );
                  }}
                  className="btn-ghost mb-2 inline-flex items-center gap-1.5 border-el text-xs text-mute hover:text-ink"
                >
                  <Ban className="h-3.5 w-3.5" />
                  Cancelar delegación
                </button>
              )}

              {/* Eliminar la tarea por completo (soft-delete; si había corrida
                  viva el puente la mata al detectar el borrado). */}
              <button
                disabled={acting}
                onClick={handleDelete}
                className="btn-ghost mb-4 inline-flex items-center gap-1.5 border-el text-xs text-danger hover:bg-panel2"
              >
                {acting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Eliminar tarea
              </button>

              {/* Artefactos: carpeta/reporte abribles desde el PC */}
              <ArtifactsBlock
                task={task}
                plan={runs.find((r) => r.plan && r.plan.length > 0)?.plan}
              />

              {/* Timeline de corridas */}
              <label className="label">Corridas</label>
              {runs.length === 0 && (
                <p className="text-xs text-faint">
                  Todavía no hay corridas (la tarea está en cola).
                </p>
              )}
              <div className="space-y-2.5">
                {runs.map((run) => (
                  <div
                    key={run._id}
                    className="rounded-el border-el border-line bg-panel2/40 p-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-mute">
                      <RunStateChip state={run.state} />
                      <span title={new Date(run.startedAt).toLocaleString("es-CL")}>
                        {formatRelative(run.startedAt)}
                      </span>
                      {run.model && (
                        <span className="font-mono">{run.model.split("/").pop()}</span>
                      )}
                      {run.resumed && <span>· seguimiento</span>}
                      {run.sessionId && (
                      <span
                        className="inline-flex items-center gap-1"
                        title="La lista de sesiones del desktop se refresca al reiniciarlo o cambiar de workspace; para abrirla ya mismo, /resume con este id"
                      >
                        <span className="truncate font-mono text-[10px] text-faint">
                          {run.sessionId.slice(0, 18)}…
                        </span>
                        <button
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(run.sessionId!)
                              .then(() =>
                                toast.success(
                                  "sessionId copiado — en ZCode: /resume <id>",
                                ),
                              );
                          }}
                          className="rounded p-0.5 text-faint transition-colors hover:bg-panel hover:text-ink"
                          title="Copiar sessionId (para /resume en ZCode)"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </span>
                      )}
                    </div>
                    {run.workspacePath && (
                      <p className="mt-1 truncate font-mono text-[10px] text-faint">
                        {run.workspacePath}
                      </p>
                    )}
                    {/* Checklist de pasos + actividad en vivo */}
                    <div className="mt-1.5">
                      <StepList run={run} />
                    </div>
                    {run.followUp && (
                      <p className="mt-1 text-[11px] text-mute">
                        <span className="font-semibold">Contexto de Cris:</span>{" "}
                        {run.followUp}
                      </p>
                    )}
                    {run.summary && run.endedAt && (
                      <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-ink">
                        {run.summary}
                      </p>
                    )}
                    {run.error && (
                      <p className="mt-1.5 rounded-el bg-red-500/10 p-1.5 text-[11px] text-red-600 dark:text-red-400">
                        {run.error}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
