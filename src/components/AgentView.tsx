/**
 * Vista "Agente" — el centro de mando de la delegación (solo web).
 *
 * Secciones: En cola · En ejecución · Requiere tu OK · Hecho hoy, más el banner
 * de estado del puente y la gestión del registro de carpetas (agentWorkspaces:
 * clase Git vs local, tipos admitidos, habilitar/deshabilitar).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Circle,
  CircleDot,
  Plus,
  Trash2,
  FolderGit2,
  Folder,
  ExternalLink,
} from "lucide-react";
import toast from "react-hot-toast";
import type { Doc } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import { useAuth } from "../hooks/useAuth";
import {
  AREA_META,
  AGENT_STATE_META,
  TASK_TYPE_META,
  type AgentState,
  type TaskType,
  type Area,
} from "../lib/constants";
import { cn, formatRelative } from "../lib/utils";
import { AgentRunsPanel } from "./AgentRunsPanel";

type OverviewTask = Doc<"tasks">;

function TaskRow({ task, onOpen }: { task: OverviewTask; onOpen: () => void }) {
  const meta = AGENT_STATE_META[(task.agentState ?? "encolada") as AgentState];
  const typeMeta = task.taskType ? TASK_TYPE_META[task.taskType as TaskType] : null;
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-2.5 rounded-el border-el border-line bg-panel2/40 px-3 py-2.5 text-left transition-colors hover:bg-panel2"
    >
      <span
        className={cn("shrink-0", meta?.pulse && "animate-pulse")}
        style={{ color: meta?.tone }}
      >
        <meta.Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-ink">
          {task.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-faint">
          {typeMeta && <span>{typeMeta.label}</span>}
          {task.workspacePath && (
            <span className="truncate font-mono">{task.workspacePath}</span>
          )}
          {task.updatedAt && <span>· {formatRelative(task.updatedAt)}</span>}
        </span>
      </span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-faint" />
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
        <div className="space-y-1.5">{children}</div>
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
  const [panelTask, setPanelTask] = useState<OverviewTask | null>(null);

  // Sembrar carpetas la primera vez (idempotente; trae las 26 de mcp_servers
  // + los repos de git_provisorio).
  useEffect(() => {
    if (token) void seedWorkspaces({ sessionToken: token }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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

  return (
    <div className="space-y-5">
      {/* Banner del puente */}
      <div className="flex items-center gap-2 rounded-el border-el border-line bg-panel2/40 px-3 py-2.5 text-xs">
        {bridge?.active ? (
          <>
            <CircleDot className="h-4 w-4 text-emerald-500" />
            <span className="font-medium text-ink">Puente activo</span>
            <span className="text-faint">
              — las tareas se despachan en segundos
              {bridge.lastHeartbeat
                ? ` (último latido ${formatRelative(bridge.lastHeartbeat)})`
                : ""}
            </span>
          </>
        ) : (
          <>
            <Circle className="h-4 w-4 text-amber-500" />
            <span className="font-medium text-ink">Puente apagado</span>
            <span className="text-faint">
              — las tareas delegadas quedan encoladas hasta que corras{" "}
              <code className="rounded bg-panel px-1 py-0.5 font-mono text-[10px]">
                npm run agent-bridge
              </code>{" "}
              en tu PC
            </span>
          </>
        )}
      </div>

      {/* Las 4 secciones del ciclo */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="En cola" count={overview?.queue.length ?? 0}>
          {overview?.queue.map((t) => (
            <TaskRow key={t._id} task={t} onOpen={() => setPanelTask(t)} />
          ))}
        </Section>
        <Section title="En ejecución" count={overview?.working.length ?? 0}>
          {overview?.working.map((t) => (
            <TaskRow key={t._id} task={t} onOpen={() => setPanelTask(t)} />
          ))}
        </Section>
        <Section title="Requiere tu OK" count={overview?.review.length ?? 0}>
          {overview?.review.map((t) => (
            <TaskRow key={t._id} task={t} onOpen={() => setPanelTask(t)} />
          ))}
        </Section>
        <Section title="Hecho hoy" count={overview?.done.length ?? 0}>
          {overview?.done.map((t) => (
            <TaskRow key={t._id} task={t} onOpen={() => setPanelTask(t)} />
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
                    <span className="ml-1.5 font-normal text-faint">
                      {AREA_META[ws.area as Area]?.label ?? ws.area}
                    </span>
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

      {/* Nota de extensión */}
      <p className="flex items-center gap-1.5 text-[10px] text-faint">
        <Plus className="h-3 w-3" />
        Para agregar carpetas nuevas: botón "Carpetas del agente" → se suman
        desde el registro (o re-ejecutá el sembrado). Contrato completo en
        CONTRATO_AGENTE.md del repo.
      </p>

      <AgentRunsPanel
        task={panelTask}
        open={!!panelTask}
        onClose={() => setPanelTask(null)}
      />
    </div>
  );
}
