/**
 * Vista "Agente" — centro de mando de la delegación (solo web).
 *
 * Rediseño "misión de control": cada fase de la delegación tiene su propia
 * tarjeta con el ESTADO del agente como protagonista y la acción en vivo
 * debajo (qué está haciendo ahora), sin el detalle completo — eso vive en el
 * panel de corridas que se abre al tocar la tarjeta. Acciones rápidas según
 * la fase (aprobar en para-revisión, responder pregunta) sin abrir nada.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Circle,
  CircleDot,
  Trash2,
  FolderGit2,
  Folder,
  Eye,
  Check,
  MessageCircle,
  Zap,
  Clock3,
} from "lucide-react";
import toast from "react-hot-toast";
import type { Doc } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import { useAuth } from "../hooks/useAuth";
import {
  AGENT_STATE_META,
  TASK_TYPE_META,
  type AgentState,
  type TaskType,
} from "../lib/constants";
import { cn, formatAgo, formatRelative } from "../lib/utils";
import { AgentRunsPanel } from "./AgentRunsPanel";

type OverviewTask = Doc<"tasks">;

/** Chip de identidad del agente que corre la tarea (ZCode + modelo). */
function AgentIdentity({ model, pulse }: { model?: string; pulse?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border-el px-1.5 py-0.5 text-[10px] font-semibold text-fuchsia-600 dark:text-fuchsia-400",
        pulse && "animate-pulse",
      )}
      style={{
        borderColor: "color-mix(in srgb, var(--status-en-curso) 40%, transparent)",
        background: "color-mix(in srgb, var(--status-en-curso) 8%, transparent)",
      }}
      title="Agente ZCode"
    >
      <Zap className="h-3 w-3" />
      ZCode{model ? ` · ${model.split("/").pop()}` : ""}
    </span>
  );
}

/** Línea "qué está haciendo ahora" (paso reportado o actividad del puente). */
function NowLine({ text, at, stalled }: { text: string; at?: number; stalled?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-el px-2.5 py-2 text-xs",
        stalled
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : "bg-panel text-ink",
      )}
      title={text}
    >
      <span
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          stalled ? "bg-amber-500" : "animate-pulse bg-fuchsia-500",
        )}
      />
      <span className="min-w-0 flex-1 truncate font-medium">{text}</span>
      {at && <span className="shrink-0 text-[10px] text-faint">{formatAgo(at)}</span>}
    </div>
  );
}

function AgentCard({
  task,
  bridgeBusyWith,
  onOpen,
  onApprove,
}: {
  task: OverviewTask;
  bridgeBusyWith?: string;
  onOpen: () => void;
  onApprove: () => void;
}) {
  const state = (task.agentState ?? "encolada") as AgentState;
  const meta = AGENT_STATE_META[state];
  const typeMeta = task.taskType ? TASK_TYPE_META[task.taskType as TaskType] : null;
  const working = ["despachada", "trabajando"].includes(state);

  // Tono de fase: borde izquierdo + tinte sutil del estado.
  return (
    <button
      onClick={onOpen}
      className={cn(
        "block w-full overflow-hidden rounded-el border-el border-line bg-panel2/40 p-3 text-left transition-colors hover:bg-panel2",
        meta?.pulse && "border-fuchsia-500/40",
      )}
      style={{ borderLeftWidth: "3px", borderLeftColor: meta?.tone }}
    >
      {/* Estado del agente COMO protagonista */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-bold",
            meta?.pulse && "animate-pulse",
          )}
          style={{
            color: meta?.tone,
            background: `color-mix(in srgb, ${meta?.tone} 12%, transparent)`,
          }}
        >
          <meta.Icon className="h-4 w-4" />
          {meta?.label}
        </span>
        <AgentIdentity model={task.model ?? undefined} pulse={working} />
        <span className="ml-auto text-[10px] text-faint" title={new Date(task.updatedAt).toLocaleString("es-CL")}>
          {formatAgo(task.updatedAt)}
        </span>
      </div>

      {/* Título de la tarea: secundario al estado */}
      <p className="mt-2 truncate text-sm font-semibold text-ink" title={task.title}>
        {task.title}
      </p>
      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-faint">
        {typeMeta && <span>{typeMeta.label}</span>}
        {task.workspacePath && (
          <span className="truncate font-mono" title={task.workspacePath}>
            · {task.workspacePath}
          </span>
        )}
      </p>

      {/* Cuerpo por fase: la acción en vivo como protagonista, sin detalle */}
      <div className="mt-2.5 space-y-2">
        {working && task.agentLastStep && (
          <NowLine text={task.agentLastStep} at={task.agentLastStepAt} />
        )}

        {state === "encolada" && (
          <div className="flex items-center gap-2 rounded-el bg-panel px-2.5 py-2 text-xs text-mute">
            <Clock3 className="h-3.5 w-3.5 shrink-0 text-faint" />
            {bridgeBusyWith ? (
              <span className="min-w-0 truncate">
                Esperando turno — el puente está con "{bridgeBusyWith}"
              </span>
            ) : (
              <span>Esperando al puente (si está apagado, encendélo en tu PC)</span>
            )}
          </div>
        )}

        {state === "pregunta" && task.agentQuestion && (
          <div
            className="rounded-el px-2.5 py-2 text-xs"
            style={{ background: "color-mix(in srgb, var(--status-urgente) 8%, transparent)" }}
          >
            <p className="line-clamp-2 text-mute" title={task.agentQuestion}>
              {task.agentQuestion}
            </p>
            <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-ink">
              <Eye className="h-3 w-3" /> Tocá para responder
            </p>
          </div>
        )}

        {state === "para-revision" && (
          <p className="line-clamp-2 text-xs text-mute" title={task.agentLastStep ?? ""}>
            {task.agentLastStep ?? "El agente terminó y espera tu OK."}
          </p>
        )}

        {state === "hecho" && (
          <p className="flex items-center gap-1.5 text-xs text-mute">
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
            Aprobada {task.completedAt ? `· ${formatRelative(task.completedAt)}` : ""}
          </p>
        )}

        {state === "error" && (
          <p className="line-clamp-2 rounded-el bg-red-500/10 px-2.5 py-2 text-xs text-red-600 dark:text-red-400">
            La corrida falló — tocá para ver el detalle y reintentar.
          </p>
        )}
      </div>

      {/* Footer: canal de avisos + acciones rápidas de fase */}
      <div className="mt-2.5 flex items-center gap-2">
        {task.notifyWhatsapp && task.notifyWhatsapp !== "off" && (
          <span
            className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400"
            title={`WhatsApp: avisos ${task.notifyWhatsapp === "final" ? "solo del resultado" : "periódicos"} vía Hermes`}
          >
            <MessageCircle className="h-3 w-3" />
            {task.notifyWhatsapp === "final" ? "resultado" : "periódico"}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {state === "para-revision" && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onApprove();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.stopPropagation();
                  onApprove();
                }
              }}
              className="btn-primary inline-flex items-center gap-1 px-2 py-1 text-[11px]"
            >
              <Check className="h-3 w-3" /> Aprobar
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-faint">
            <Eye className="h-3 w-3" /> Ver
          </span>
        </span>
      </div>
    </button>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-mute">
        {title}
        <span className="rounded-full bg-panel2 px-1.5 py-0.5 text-[10px] text-faint">
          {count}
        </span>
      </h3>
      {count === 0 ? (
        <p className="rounded-el border-el border-dashed border-line px-3 py-2.5 text-[11px] text-faint">
          Nada por acá
        </p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

export function AgentView() {
  const { token } = useAuth();
  const since = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const overview = useQuery(
    api.agent.agentOverview,
    token ? { sessionToken: token, since } : "skip",
  );
  const bridge = useQuery(
    api.agent.bridgeStatus,
    token ? { sessionToken: token } : "skip",
  );
  const workspaces =
    useQuery(api.agent.listWorkspaces, token ? { sessionToken: token } : "skip") ?? [];

  const seedWorkspaces = useMutation(api.agent.seedWorkspaces);
  const updateWorkspace = useMutation(api.agent.updateWorkspace);
  const removeWorkspace = useMutation(api.agent.removeWorkspace);
  const reviewResult = useMutation(api.agent.reviewResult);
  const [panelTask, setPanelTask] = useState<OverviewTask | null>(null);

  // Sembrar carpetas la primera vez (idempotente; trae las 26 de mcp_servers
  // + los repos de git_provisorio).
  useEffect(() => {
    if (token) void seedWorkspaces({ sessionToken: token }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function quickApprove(t: OverviewTask) {
    try {
      await reviewResult({ sessionToken: token!, taskId: t._id, approve: true });
      toast.success("Aprobada: tarea completada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo aprobar");
    }
  }

  async function toggleWs(ws: Doc<"agentWorkspaces">) {
    try {
      await updateWorkspace({ sessionToken: token!, id: ws._id, enabled: !ws.enabled });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo actualizar");
    }
  }

  async function removeWs(ws: Doc<"agentWorkspaces">) {
    if (!confirm(`¿Quitar "${ws.label}" del registro de carpetas?`)) return;
    try {
      await removeWorkspace({ sessionToken: token!, id: ws._id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo eliminar");
    }
  }

  const busyWith = bridge?.activeRuns?.[0]?.title;
  const activeCount = (bridge?.activeRuns ?? []).length;

  return (
    <div className="space-y-5">
      {/* Franja de mando: qué está pasando ahora, con anuncio accesible */}
      <div
        role="status"
        aria-atomic="true"
        className="flex flex-wrap items-center gap-2 rounded-el border-el border-line bg-panel2/40 px-3 py-2.5 text-xs"
      >
        {bridge?.active ? (
          <>
            <CircleDot className="h-4 w-4 shrink-0 text-emerald-500" />
            <span className="font-medium text-ink">
              {activeCount > 0
                ? `${activeCount} agente${activeCount > 1 ? "s" : ""} trabajando`
                : "Puente activo — sin corridas"}
            </span>
            {(bridge.queueDepth ?? 0) > 0 && (
              <span className="text-faint">· {bridge.queueDepth} en cola</span>
            )}
            {(overview?.review.length ?? 0) > 0 && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                style={{
                  color: "var(--status-urgente)",
                  background: "color-mix(in srgb, var(--status-urgente) 10%, transparent)",
                }}
              >
                {overview!.review.length} requieren tu OK
              </span>
            )}
            {busyWith && (
              <span className="truncate text-faint">· "{busyWith}"</span>
            )}
          </>
        ) : (
          <>
            <Circle className="h-4 w-4 text-amber-500" />
            <span className="font-medium text-ink">Puente apagado</span>
            <span className="text-faint">
              — corré{" "}
              <code className="rounded bg-panel px-1 py-0.5 font-mono text-[10px]">
                npm run agent-bridge:daemon
              </code>{" "}
              en tu PC; las tareas quedan encoladas hasta entonces
            </span>
          </>
        )}
      </div>

      {/* Las 4 fases del ciclo, en horizontal (pipeline) — apiladas en pantallas chicas */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Section title="En cola" count={overview?.queue.length ?? 0}>
          {overview?.queue.map((t) => (
            <AgentCard
              key={t._id}
              task={t}
              bridgeBusyWith={busyWith}
              onOpen={() => setPanelTask(t)}
              onApprove={() => void quickApprove(t)}
            />
          ))}
        </Section>
        <Section title="En ejecución" count={overview?.working.length ?? 0}>
          {overview?.working.map((t) => (
            <AgentCard
              key={t._id}
              task={t}
              bridgeBusyWith={busyWith}
              onOpen={() => setPanelTask(t)}
              onApprove={() => void quickApprove(t)}
            />
          ))}
        </Section>
        <Section title="Requiere tu OK" count={overview?.review.length ?? 0}>
          {overview?.review.map((t) => (
            <AgentCard
              key={t._id}
              task={t}
              onOpen={() => setPanelTask(t)}
              onApprove={() => void quickApprove(t)}
            />
          ))}
        </Section>
        <Section title="Hecho hoy" count={overview?.done.length ?? 0}>
          {overview?.done.map((t) => (
            <AgentCard
              key={t._id}
              task={t}
              onOpen={() => setPanelTask(t)}
              onApprove={() => void quickApprove(t)}
            />
          ))}
        </Section>
      </div>

      {/* Gestión de carpetas */}
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-mute">
          Carpetas del agente
          <span className="rounded-full bg-panel2 px-1.5 py-0.5 text-[10px] text-faint">
            {workspaces.length}
          </span>
        </h3>
        <p className="mb-2 text-[11px] text-faint">
          Desarrollo → solo carpetas <strong>Git</strong> (git_provisorio) ·
          Reporte → solo carpetas <strong>locales</strong> (C:\mcp_servers, sin
          git). La validación es doble: este picker y el backend.
        </p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {workspaces.map((ws) => {
            const Icon = ws.vcs === "git" ? FolderGit2 : Folder;
            return (
              <div
                key={ws._id}
                className={cn(
                  "flex items-center gap-2 rounded-el border-el px-2.5 py-2",
                  ws.enabled ? "border-line bg-panel2/40" : "border-dashed border-line opacity-50",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    ws.vcs === "git"
                      ? "text-sky-600 dark:text-sky-400"
                      : "text-amber-600 dark:text-amber-400",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink">
                    {ws.label}
                  </p>
                  <p className="truncate font-mono text-[10px] text-faint" title={ws.path}>
                    {ws.path}
                  </p>
                </div>
                <button
                  onClick={() => void toggleWs(ws)}
                  title={ws.enabled ? "Deshabilitar" : "Habilitar"}
                  className="rounded-el p-1 text-faint hover:bg-panel hover:text-ink"
                >
                  <CircleDot
                    className={cn("h-3.5 w-3.5", ws.enabled && "text-emerald-500")}
                  />
                </button>
                <button
                  onClick={() => void removeWs(ws)}
                  title="Quitar del registro"
                  className="rounded-el p-1 text-faint hover:bg-panel hover:text-red-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <AgentRunsPanel
        task={panelTask}
        open={!!panelTask}
        onClose={() => setPanelTask(null)}
      />
    </div>
  );
}
