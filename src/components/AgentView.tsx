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
  Folder,
  Eye,
  Check,
  MessageCircle,
  Zap,
  Clock3,
  ChevronDown,
  ExternalLink,
  GitBranch,
  ChartColumn,
} from "lucide-react";import toast from "react-hot-toast";
import type { Doc } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import { useAuth } from "../hooks/useAuth";
import {
  AGENT_STATE_META,
  TASK_TYPE_META,
  type AgentState,
  type TaskType,
  type Area,
} from "../lib/constants";
import { cn, formatAgo, formatRelative } from "../lib/utils";
import { AgentRunsPanel } from "./AgentRunsPanel";
import { AgentContractSection } from "./AgentContractSection";

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
  // Link a ClickUp: desvinculada = ya no le pertenece a ClickUp.
  const clickupHref =
    task.clickupUrl ??
    (task.clickupId ? `https://app.clickup.com/t/${task.clickupId}` : undefined);

  // Tono de fase: borde izquierdo + tinte sutil del estado.
  // div role=button (y no <button>): el footer necesita un <a> real a ClickUp,
  // y anclar interactive content dentro de un button es HTML inválido.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "block w-full cursor-pointer overflow-hidden rounded-el border-el border-line bg-panel2/40 p-3 text-left transition-colors hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
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
          <NowLine
            text={
              task.agentPlanTotal
                ? `Paso ${task.agentStepIndex ?? "?"}/${task.agentPlanTotal}: ${task.agentLastStep}`
                : task.agentLastStep
            }
            at={task.agentLastStepAt}
          />
        )}

        {state === "encolada" && (
          <div className="flex items-center gap-2 rounded-el bg-panel px-2.5 py-2 text-xs text-mute">
            <Clock3 className="h-3.5 w-3.5 shrink-0 text-faint" />
            {bridgeBusyWith ? (
              <span className="min-w-0 truncate">
                Esperando turno — el puente está con "{bridgeBusyWith}"
              </span>
            ) : (
              <span>Esperando al puente (si está apagado, enciéndelo en tu PC)</span>
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
              <Eye className="h-3 w-3" /> Toca para responder
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
            La corrida falló — toca para ver el detalle y reintentar.
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
        {/* Link a la tarea en ClickUp: ver cómo quedó allá sin abrir nada más. */}
        {clickupHref && !task.clickupDetached && (
          <a
            href={clickupHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Abrir esta tarea en ClickUp"
            className="inline-flex items-center gap-1 rounded-el border-el border-line px-1.5 py-0.5 text-[10px] font-medium text-mute transition-colors hover:border-accent/40 hover:text-accent"
          >
            <ExternalLink className="h-3 w-3" />
            ClickUp
          </a>
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
    </div>
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

/**
 * Historial de delegaciones terminadas (hecho de días anteriores + canceladas).
 * Formato tabla compacta — una línea por tarea — con paginación de 20 por
 * página (‹ ›): las tarjetas grandes se acumulaban en un scroll vertical
 * infinito (pedido explícito de Cris). Al tocar una línea se abre el panel
 * de corridas completo, igual que en el pipeline.
 */
function HistorySection({
  items,
  onOpen,
}: {
  items: OverviewTask[];
  onOpen: (t: OverviewTask) => void;
}) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem("agent-history-open") !== "0";
    } catch {
      return true;
    }
  });
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const visible = items.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function toggle() {
    setOpen((v) => {
      try {
        localStorage.setItem("agent-history-open", v ? "0" : "1");
      } catch {
        /* sin localStorage: igual colapsa visualmente */
      }
      return !v;
    });
  }
  if (items.length === 0) return null;
  return (
    <section>
      <button
        onClick={toggle}
        aria-expanded={open}
        className="mb-2 flex w-full items-center gap-2 text-left text-xs font-semibold uppercase tracking-wide text-mute hover:text-ink"
      >
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-faint transition-transform", open && "rotate-180")}
        />
        Historial del agente
        <span className="rounded-full bg-panel2 px-1.5 py-0.5 text-[10px] font-normal text-faint">
          {items.length}
        </span>
        <span className="ml-auto text-[10px] font-normal normal-case text-faint">
          terminadas de días anteriores
        </span>
      </button>
      {open && (
        <>
          <div className="overflow-hidden rounded-el border-el border-line bg-panel2/40">
            {visible.map((t, i) => (
              <HistoryRow
                key={t._id}
                task={t}
                zebra={i % 2 === 1}
                onOpen={() => onOpen(t)}
              />
            ))}
          </div>
          {pages > 1 && (
            <div className="mt-1.5 flex items-center justify-end gap-2 text-[11px] text-faint">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                title="Página anterior"
                className="rounded-el border-el border-line px-2 py-0.5 hover:text-ink disabled:opacity-30"
              >
                ‹
              </button>
              <span>
                {safePage + 1} de {pages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                disabled={safePage === pages - 1}
                title="Página siguiente"
                className="rounded-el border-line border-el px-2 py-0.5 hover:text-ink disabled:opacity-30"
              >
                ›
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Una línea del historial: estado · título · cuándo · link ClickUp · ver.
 *  GRID con TODAS las columnas en medida fija (solo el título es 1fr):
 *  cada fila es su propia grilla, así que cualquier columna "auto" se medía
 *  contra el contenido DE ESA fila y las filas quedaban desalineadas entre sí
 *  (segundo reporte de Cris). Fijas, se alinean píxel a píxel siempre. */
function HistoryRow({
  task,
  zebra,
  onOpen,
}: {
  task: OverviewTask;
  zebra: boolean;
  onOpen: () => void;
}) {
  const state = (task.agentState ?? "hecho") as AgentState;
  const meta = AGENT_STATE_META[state];
  const when = task.completedAt ?? task.updatedAt;
  const clickupHref =
    task.clickupUrl ??
    (task.clickupId ? `https://app.clickup.com/t/${task.clickupId}` : undefined);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      title={`${meta?.label ?? ""} — tocar para ver las corridas${task.model ? ` · ${task.model.split("/").pop()}` : ""}`}
      className={cn(
        "grid w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-xs transition-colors hover:bg-panel2",
        zebra && "bg-panel/40",
      )}
      style={{
        gridTemplateColumns: "1.25rem minmax(0, 1fr) 4.5rem 5.5rem 1.75rem 1.75rem 2.5rem",
      }}
    >
      <meta.Icon className="h-3.5 w-3.5" style={{ color: meta?.tone }} />
      <span className="min-w-0 truncate font-medium text-ink">{task.title}</span>
      <span
        className="truncate text-[10px] font-medium"
        style={{ color: meta?.tone }}
      >
        {meta?.label}
      </span>
      <span
        className="truncate text-right text-[10px] text-faint"
        title={new Date(when).toLocaleString("es-CL")}
      >
        {formatRelative(when)}
      </span>
      {task.agentSessionId && task.workspacePath ? (
        <a
          href={`hermesagent://zcode?path=${encodeURIComponent(task.workspacePath)}&session=${encodeURIComponent(task.agentSessionId)}`}
          onClick={(e) => e.stopPropagation()}
          title="Chatear con el agente en terminal: abre zchat contra la sesión EXACTA de esta tarea, con todo su contexto (~30-90s por respuesta). Tildá 'Siempre permitir' en el diálogo del navegador."
          className="place-self-center rounded-el p-0.5 text-faint hover:text-accent"
        >
          <MessageCircle className="h-3.5 w-3.5" />
        </a>
      ) : (
        <span />
      )}
      {clickupHref && !task.clickupDetached ? (
        <a
          href={clickupHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Abrir en ClickUp"
          className="place-self-center rounded-el p-0.5 text-faint hover:text-accent"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : (
        // Columna fija reservada: el hueco mantiene la alineación aunque la
        // tarea no tenga ClickUp.
        <span />
      )}
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] font-medium text-faint">
        <Eye className="h-3 w-3" /> Ver
      </span>
    </div>
  );
}

/**
 * Grupo colapsable de carpetas (Desarrollo / Reportes). Cerrado por defecto
 * (el estado se recuerda en localStorage): 38 carpetas sueltas eran ruido.
 * Incluye alta de carpetas nuevas directamente en su grupo (el vcs queda
 * fijado por el grupo, así nunca se mezclan mundos).
 */
function WorkspaceGroup({
  storageKey,
  title,
  subtitle,
  Icon,
  tone,
  vcs,
  items,
  onToggle,
  onRemove,
  onAdd,
}: {
  storageKey: string;
  title: string;
  subtitle: string;
  Icon: typeof GitBranch;
  tone: string;
  vcs: "git" | "ninguno";
  items: Doc<"agentWorkspaces">[];
  onToggle: (ws: Doc<"agentWorkspaces">) => Promise<void>;
  onRemove: (ws: Doc<"agentWorkspaces">) => Promise<void>;
  onAdd: (input: { path: string; label: string; area: Area }) => Promise<void>;
}) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  const [area, setArea] = useState<Area>("patagonia");
  const [saving, setSaving] = useState(false);

  function toggleOpen() {
    setOpen((v) => {
      try {
        localStorage.setItem(storageKey, v ? "0" : "1");
      } catch {
        // sin localStorage: igual colapsa visualmente
      }
      return !v;
    });
  }

  async function handleAdd() {
    if (!path.trim()) {
      toast.error("Pega la ruta completa de la carpeta");
      return;
    }
    setSaving(true);
    try {
      const cleanPath = path.trim().replace(/[\\/]+$/, "");
      await onAdd({
        path: cleanPath,
        label: label.trim() || cleanPath.split(/[\\/]/).pop() || cleanPath,
        area,
      });
      toast.success("Carpeta agregada");
      setPath("");
      setLabel("");
      setAdding(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo agregar");
    } finally {
      setSaving(false);
    }
  }

  const activeCount = items.filter((w) => w.enabled).length;
  return (
    <div className="overflow-hidden rounded-el border-el border-line">
      <button
        onClick={toggleOpen}
        aria-expanded={open}
        className="flex w-full items-center gap-2 bg-panel2/40 px-3 py-2.5 text-left transition-colors hover:bg-panel2"
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-faint transition-transform",
            open && "rotate-180",
          )}
        />
        <Icon className={cn("h-4 w-4 shrink-0", tone)} />
        <span className="text-xs font-semibold text-ink">{title}</span>
        <span className="text-[10px] text-faint">· {subtitle}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-faint">
          <span className="text-emerald-600 dark:text-emerald-400">
            {activeCount} activas
          </span>
          <span className="rounded-full bg-panel px-1.5 py-0.5">{items.length}</span>
        </span>
      </button>
      {open && (
        <div className="p-2">
          {/* Alta de carpeta dentro de este grupo */}
          <div className="mb-2 px-1">
            {adding ? (
              <div className="space-y-1.5 rounded-el border-el border-line bg-panel p-2">
                <input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder={
                    vcs === "git"
                      ? "C:\\Users\\patag\\git_provisorio\\nuevo_repo"
                      : "C:\\mcp_servers\\Nuevo Reporte"
                  }
                  autoFocus
                  className="input font-mono text-xs"
                />
                <div className="flex flex-wrap gap-1.5">
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Nombre (opcional — si no, el de la carpeta)"
                    className="input flex-1 text-xs"
                  />
                  <select
                    value={area}
                    onChange={(e) => setArea(e.target.value as Area)}
                    className="input w-auto text-xs"
                  >
                    <option value="patagonia">Patagonia</option>
                    <option value="datacef">Datacef</option>
                    <option value="personal">Personal</option>
                  </select>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => void handleAdd()}
                    disabled={saving}
                    className="btn-primary px-2.5 py-1 text-[11px]"
                  >
                    {saving ? "Guardando…" : "Agregar"}
                  </button>
                  <button
                    onClick={() => setAdding(false)}
                    className="btn-ghost border-el px-2.5 py-1 text-[11px] text-mute"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-mute transition-colors hover:text-ink"
              >
                + Agregar carpeta a {title.toLowerCase()}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((ws) => (
              <div
                key={ws._id}
                className={cn(
                  "flex items-center gap-2 rounded-el border-el px-2.5 py-2",
                  ws.enabled
                    ? "border-line bg-panel2/40"
                    : "border-dashed border-line opacity-50",
                )}
              >
                <Folder className="h-3.5 w-3.5 shrink-0 text-faint" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink">{ws.label}</p>
                  <p className="truncate font-mono text-[10px] text-faint" title={ws.path}>
                    {ws.path}
                  </p>
                </div>
                <button
                  onClick={() => void onToggle(ws)}
                  title={ws.enabled ? "Deshabilitar" : "Habilitar"}
                  className="rounded-el p-1 text-faint hover:bg-panel hover:text-ink"
                >
                  <CircleDot
                    className={cn("h-3.5 w-3.5", ws.enabled && "text-emerald-500")}
                  />
                </button>
                <button
                  onClick={() => void onRemove(ws)}
                  title="Quitar del registro"
                  className="rounded-el p-1 text-faint hover:bg-panel hover:text-red-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {items.length === 0 && (
              <p className="col-span-full px-1 py-2 text-[11px] text-faint">
                Sin carpetas en este grupo — agregá la primera con el botón de arriba.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
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
  const addWorkspace = useMutation(api.agent.addWorkspace);
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
              — corre{" "}
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

      {/* Historial del agente: delegaciones terminadas de días anteriores.
          Colapsable con memoria — el trabajo del agente queda consultable
          para siempre (corridas, pasos y resúmenes al tocar la tarjeta). */}
      <HistorySection
        items={overview?.history ?? []}
        onOpen={(t) => setPanelTask(t)}
      />

      {/* Contrato del agente: visible y editable (reglas + recetas por tipo) */}
      <AgentContractSection />

      {/* Gestión de carpetas: agrupadas por mundo (Git vs locales) y
          colapsadas por defecto — la vista queda limpia. */}
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
          git). La validación es doble: el picker y el backend.
        </p>
        <div className="space-y-2">
          <WorkspaceGroup
            storageKey="agent-ws-dev-open"
            title="Desarrollo"
            subtitle="repos Git de git_provisorio"
            Icon={GitBranch}
            tone="text-sky-600 dark:text-sky-400"
            vcs="git"
            items={workspaces.filter((w) => w.vcs === "git")}
            onToggle={toggleWs}
            onRemove={removeWs}
            onAdd={async (input) => {
              await addWorkspace({
                sessionToken: token!,
                ...input,
                vcs: "git",
                types: ["desarrollo", "analisis", "ops", "otro"],
              });
            }}
          />
          <WorkspaceGroup
            storageKey="agent-ws-rep-open"
            title="Reportes"
            subtitle="carpetas locales de C:\mcp_servers (sin git)"
            Icon={ChartColumn}
            tone="text-amber-600 dark:text-amber-400"
            vcs="ninguno"
            items={workspaces.filter((w) => w.vcs === "ninguno")}
            onToggle={toggleWs}
            onRemove={removeWs}
            onAdd={async (input) => {
              await addWorkspace({
                sessionToken: token!,
                ...input,
                vcs: "ninguno",
                types: ["reporte", "analisis", "otro"],
              });
            }}
          />
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
