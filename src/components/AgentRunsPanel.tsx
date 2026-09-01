/**
 * Panel de delegación de una tarea (executor=zcode): timeline de corridas con
 * resúmenes/evidencia, respuesta a preguntas, aprobación/rechazo y cancelación.
 * Se abre desde la tarjeta (web) o desde la vista Agente.
 */
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CornerDownRight, Check, Ban, Send, Loader2, Copy } from "lucide-react";
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
import { cn, formatRelative } from "../lib/utils";

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
  const runs =
    useQuery(
      api.agent.runsByTask,
      token && task ? { sessionToken: token, taskId: task._id } : "skip",
    ) ?? [];
  const answerQuestion = useMutation(api.agent.answerQuestion);
  const reviewResult = useMutation(api.agent.reviewResult);
  const cancelAgent = useMutation(api.agent.cancelAgent);

  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [acting, setActing] = useState(false);

  if (!task) return null;
  const state = (task.agentState ?? null) as AgentState | null;
  const typeMeta = task.taskType ? TASK_TYPE_META[task.taskType as TaskType] : null;
  const autoMeta = task.autonomy ? AUTONOMY_META[task.autonomy as Autonomy] : null;

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

  const canAnswer = state === "pregunta" || state === "error";
  const canReview = state === "para-revision";
  const canCancel =
    state &&
    !["hecho", "cancelada"].includes(state);

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

              {/* Responder (pregunta o error → re-encola con tu respuesta) */}
              {canAnswer && (
                <div className="mb-4">
                  <label className="label">
                    {state === "pregunta" ? "Tu respuesta" : "Qué corregir / reintentar"}
                  </label>
                  <textarea
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    rows={3}
                    placeholder={
                      state === "pregunta"
                        ? "El contexto o la decisión que le falta al agente…"
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
                        "Enviado: el agente retoma con tu respuesta",
                      )
                    }
                    className="btn-primary mt-2 inline-flex items-center gap-1.5 text-xs"
                  >
                    {acting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Enviar al agente
                  </button>
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
                  className="btn-ghost mb-4 inline-flex items-center gap-1.5 border-el text-xs text-mute hover:text-ink"
                >
                  <Ban className="h-3.5 w-3.5" />
                  Cancelar delegación
                </button>
              )}

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
                    {run.followUp && (
                      <p className="mt-1 text-[11px] text-mute">
                        <span className="font-semibold">Contexto de Cris:</span>{" "}
                        {run.followUp}
                      </p>
                    )}
                    {run.summary && (
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
