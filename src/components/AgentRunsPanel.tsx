/**
 * Panel de delegación de una tarea (executor=zcode): timeline de corridas con
 * resúmenes/evidencia, respuesta a preguntas, aprobación/rechazo y cancelación.
 * Se abre desde la tarjeta (web) o desde la vista Agente.
 */
import { useState, type ReactNode } from "react";
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
  EXECUTOR_META,
  isDelegatedExecutor,
  type AgentState,
  type Autonomy,
  type TaskType,
} from "../lib/constants";
import { cn, formatRelative, formatAgo, agentModelLabel } from "../lib/utils";
import {
  ContextPicker,
  EMPTY_CONTEXT,
  type ContextPaths,
} from "./ContextPicker";

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
 *  hermesagent:// (instalado en el PC de Cris por agent-bridge).
 *  `task` debe ser la tarea EN VIVO (t): la sesión se bindea a mitad de
 *  corrida y con el snapshot viejo el botón de chat no aparecía nunca.
 *  `session` = sessionId efectivo (tarea, con la corrida más reciente de
 *  respaldo para el caso de bind temprano fallido). */
function ArtifactsBlock({
  task,
  plan,
  session,
  since,
}: {
  task: Doc<"tasks">;
  /** Plan de la última corrida (para el sidebar del chat). */
  plan?: string[];
  /** SessionId efectivo: de la tarea en vivo, o de la última corrida. */
  session?: string;
  /** Inicio de la última corrida: el reporte .md debe ser posterior (evita
   *  abrir un .md viejo cualquiera cuando la corrida no generó reporte). */
  since?: number;
}) {
  if (!task.workspacePath) return null;
  const open = (mode: "open" | "file" | "md", path: string) => {
    const extra =
      mode === "md" && since ? `&since=${Math.max(0, since - 60_000)}` : "";
    window.location.href = `hermesagent://${mode}?path=${encodeURIComponent(path)}${extra}`;
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
        {isDelegatedExecutor(task.executor) && (
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
              // Host del deep link = agente dueño de la sesión (zcode|claude);
              // el protocol handler enruta al chat del adaptador correcto.
              const host = task.executor === "claude" ? "claude" : "zcode";
              // task → el servidor del chat se suscribe a Convex y muestra el
              // plan, el paso actual y el estado EN VIVO (p64/st/ag quedan
              // como respaldo si el puente no tiene credenciales).
              // La sesión puede NO existir todavía (corrida recién arrancada):
              // el chat abre en modo "esperando sesión" y la adopta apenas
              // el agente la registre.
              window.location.href = `hermesagent://${host}?path=${encodeURIComponent(task.workspacePath!)}${session ? `&session=${encodeURIComponent(session)}` : ""}&task=${encodeURIComponent(task._id)}&p64=${p64}&st=${encodeURIComponent(st)}&ag=${encodeURIComponent(ag)}`;
            }}
            className="btn-ghost inline-flex items-center gap-1.5 border-el text-xs hover:text-ink"
            title={
              session
                ? ["planificando", "despachada", "trabajando"].includes(task.agentState ?? "")
                  ? "Abre una página de chat en tu navegador contra la sesión EXACTA de esta tarea, EN MODO OBSERVADOR mientras la corrida está activa: historial y razonamiento en vivo. Tildá 'Siempre permitir' la primera vez."
                  : "Abre una página de chat en tu navegador contra la sesión EXACTA de esta tarea: historial completo, razonamiento y respuesta en vivo, y el plan de la tarea actualizado en tiempo real. Tildá 'Siempre permitir' la primera vez."
                : "Abre el chat de la tarea: si el agente todavía no registró su sesión, queda esperando y el razonamiento aparece solo en cuanto arranque. Tildá 'Siempre permitir' la primera vez."
            }
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {session
              ? ["planificando", "despachada", "trabajando"].includes(task.agentState ?? "")
                ? "Ver razonamiento en vivo"
                : "Chatear con el agente"
              : "Chat del agente (espera sesión)"}
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
            title="Abre el .md modificado más recientemente en esa carpeta DESDE QUE EMPEZÓ la corrida. Si la corrida no generó reporte, te avisa en vez de abrir un archivo viejo."
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
/** Duración legible para telemetría: "45s" / "2m 10s" / "1h 03m". */
function fmtDur(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "–";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/**
 * Telemetría de punta a punta de una corrida: cuánto esperó en cola (al
 * puente), cuánto tardó el proceso en subir, la sesión en aparecer, la
 * primera actividad del agente y el total. Justo para diagnosticar "mandé
 * la tarea y no pasaba nada": cada tramo señala su responsable.
 */
function RunTiming({
  run,
  queuedAt,
}: {
  run: Doc<"agentRuns">;
  queuedAt?: number;
}) {
  const spawnAt = run.phases?.find((p) => p.phase === "spawn")?.at;
  const sessionAt = run.phases?.find((p) => p.phase === "session")?.at;
  const bits: string[] = [];
  if (queuedAt && run.startedAt - queuedAt > 1500)
    bits.push(`en cola ${fmtDur(run.startedAt - queuedAt)}`);
  if (spawnAt) bits.push(`proceso +${fmtDur(spawnAt - run.startedAt)}`);
  if (sessionAt) bits.push(`sesión +${fmtDur(sessionAt - run.startedAt)}`);
  if (run.firstActivityAt)
    bits.push(`1ª actividad +${fmtDur(run.firstActivityAt - run.startedAt)}`);
  if (run.endedAt) bits.push(`total ${fmtDur(run.endedAt - run.startedAt)}`);
  if (bits.length === 0) return null;
  return (
    <p
      className="mt-0.5 font-mono text-[10px] text-faint"
      title="Telemetría de la corrida: espera en cola → arranque del proceso → sesión disponible → primera actividad → total"
    >
      ⏱ {bits.join(" · ")}
    </p>
  );
}

/** Inline markdown ligero del texto del agente: **negritas** y `código`. */
function renderInlineMd(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith("**") && part.endsWith("**"))
      return (
        <strong key={key} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code key={key} className="rounded-el bg-panel2 px-1 py-px font-mono text-[11px]">
          {part.slice(1, -1)}
        </code>
      );
    return <span key={key}>{part}</span>;
  });
}

/**
 * Texto del resultado del agente con markdown LIGERO (lo que producen sus
 * conclusiones: encabezados ###, listas, negritas, código) renderizado con
 * la tipografía de la app. Antes se volcaba crudo con pre-wrap y se veía
 * desordenado, sin jerarquía y con "tamaños raros" (los # y ** a la vista).
 */
function SummaryText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let items: string[] = [];
  let ordered = false;
  let listId = 0;
  const flush = () => {
    if (!items.length) return;
    const listItems = items;
    items = [];
    const List = ordered ? "ol" : "ul";
    blocks.push(
      <List
        key={`l${listId++}`}
        className={cn(
          "mt-1 space-y-0.5 pl-4 text-xs leading-relaxed text-mute",
          ordered ? "list-decimal" : "list-disc",
        )}
      >
        {listItems.map((it, i) => (
          <li key={i} className="pl-0.5 marker:text-faint">
            {renderInlineMd(it, `li${listId}-${i}`)}
          </li>
        ))}
      </List>,
    );
  };
  text.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t) {
      flush();
      return;
    }
    const h = t.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      flush();
      blocks.push(
        <p
          key={i}
          className="label mb-1 mt-2.5 text-[10px] font-semibold uppercase tracking-wide text-faint first:mt-0"
        >
          {renderInlineMd(h[1], `h${i}`)}
        </p>,
      );
      return;
    }
    const bullet = t.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      if (items.length === 0) ordered = false;
      items.push(bullet[1]);
      return;
    }
    const num = t.match(/^(\d+)[.)]\s+(.*)$/);
    if (num) {
      if (items.length === 0) ordered = true;
      items.push(num[2]);
      return;
    }
    flush();
    blocks.push(
      <p
        key={i}
        className="text-xs leading-relaxed text-mute [&:not(:first-child)]:mt-1.5"
      >
        {renderInlineMd(t, `p${i}`)}
      </p>,
    );
  });
  flush();
  return <div className="min-w-0">{blocks}</div>;
}

/**
 * Caja de resultado final de una corrida: la conclusión/entrega del agente
 * claramente separada del checklist de pasos — label + icono + tipografía
 * consistente con el design system (antes era un párrafo suelto sin marco).
 */
function SummaryBlock({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <div className="mt-2 rounded-el border-el border-line bg-panel p-3">
      <p className="label mb-1.5 flex items-center gap-1.5">
        <FileText className="h-3.5 w-3.5" />
        {title}
      </p>
      <SummaryText text={text} />
    </div>
  );
}

/** Plan declarado (roadmap) + checklist de pasos reales + actividad en vivo.
 *  `taskDone`: la tarea ya terminó (hecha/cancelada/completada) — una corrida
 *  "abierta" en una tarea terminada es un zombi (quedó así por un camino que
 *  no la cerró): se muestra como cerrada para que el plan no quede atorado. */
function StepList({ run, taskDone }: { run: Doc<"agentRuns">; taskDone?: boolean }) {
  const steps = run.progressLog ?? [];
  const plan = run.plan ?? [];
  const open = !run.endedAt && !taskDone;
  const doneCount = steps.length;
  // Corrida terminada BIEN (para-revisión/hecho): el objetivo se cumplió — el
  // roadmap se marca completo. El agente no siempre reporta un --step por
  // cada ítem del plan (los agrupa o los hace sin cortar), y sin esto los
  // pasos restantes quedaban "pendientes" para siempre aunque la tarea ya
  // estuviera terminada y aprobada. También aplica a corridas zombis de una
  // tarea ya hecha (las de error/cancelada se muestran como quedaron).
  const finishedOk =
    (!!run.endedAt && ["para-revision", "hecho"].includes(run.state)) ||
    (!!taskDone && !["error", "cancelada"].includes(run.state));
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
            {finishedOk
              ? `Plan · completado (${plan.length})`
              : `Plan · paso ${Math.min(doneCount + (open ? 1 : 0), plan.length) || "–"} de ${plan.length}`}
          </p>
          <ol className="space-y-0.5">
            {plan.map((p, i) => {
              const done = finishedOk || i < doneCount;
              const current = !finishedOk && open && i === doneCount;
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
  const approvePlan = useMutation(api.agent.approvePlan);
  const requestPlanChanges = useMutation(api.agent.requestPlanChanges);
  const cancelAgent = useMutation(api.agent.cancelAgent);
  const removeTask = useMutation(api.tasks.remove);
  const redirectAgent = useMutation(api.agent.redirectAgent);

  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [redirect, setRedirect] = useState("");
  const [acting, setActing] = useState(false);
  // Contexto extra para la respuesta (picker nativo): carpetas/archivos que
  // se suman a los de la tarea cuando el agente pidió más material.
  const [extraCtx, setExtraCtx] = useState<ContextPaths>(EMPTY_CONTEXT);

  if (!task || !t) return null;
  const state = (t.agentState ?? null) as AgentState | null;
  const typeMeta = t.taskType ? TASK_TYPE_META[t.taskType as TaskType] : null;
  const autoMeta = t.autonomy ? AUTONOMY_META[t.autonomy as Autonomy] : null;
  // Identidad de la delegación: agente (por executor) + modelo con label bonito.
  const agentMeta = isDelegatedExecutor(t.executor)
    ? EXECUTOR_META[t.executor]
    : null;
  const modelLabel = agentModelLabel(t.model);
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
      setExtraCtx(EMPTY_CONTEXT);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falló la acción");
    } finally {
      setActing(false);
    }
  }

  const canAnswer =
    state === "pregunta" || state === "error" || state === "cancelada";
  const canReview = state === "para-revision";
  // Tarea ya terminada (cualquier camino): las corridas zombis se muestran
  // cerradas y su roadmap completo (ver StepList).
  const taskDone =
    state === "hecho" || state === "cancelada" || t.status === "completado";
  // Modo plan: el plan cosechado de la fase de planificación espera el OK.
  const canReviewPlan = state === "plan-para-aprobar";
  // Corrida más reciente con plan (los replans la reemplazan; viene ordenada
  // de más nueva a más vieja).
  const planRun = runs.find((r) => (r.plan?.length ?? 0) > 0 || !!r.planDetail);
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
                  {agentMeta && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 font-semibold",
                        agentMeta.color,
                      )}
                      title={`Agente ${agentMeta.label}`}
                    >
                      <agentMeta.Icon className="h-3 w-3" />
                      {agentMeta.label}
                    </span>
                  )}
                  {typeMeta && <span>{typeMeta.label}</span>}
                  {autoMeta && <span>· {autoMeta.label}</span>}
                  {t.gitStrategy === "main-directo" && (
                    <span
                      className="font-semibold text-red-600 dark:text-red-400"
                      title="Commits y push directo en master/main (excepción elegida al crear la tarea): la producción se despliega por el pipeline del repo."
                    >
                      · ⚠ directo a main
                    </span>
                  )}
                  {modelLabel && <span>· {modelLabel}</span>}
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
                  <div className="mt-1 text-xs text-mute">
                    <SummaryText text={t.agentQuestion ?? ""} />
                  </div>
                </div>
              )}

              {/* Redirección en vivo: cambia el rumbo YA — interrumpe y retoma */}
              {canRedirect && (
                <div className="mb-4 rounded-el border-el border-line bg-panel2/50 p-3">
                  <label className="label flex items-center gap-1.5">
                    <Shuffle className="h-3.5 w-3.5" />
                    Redirigir al agente en vivo
                  </label>
                  {t.agentRedirect ? (
                    <p className="rounded-el bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
                      <span className="font-semibold">Entregando la instrucción…</span>{" "}
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
                        Se entrega AL INSTANTE: el puente interrumpe la corrida y
                        la retoma en la misma sesión con este nuevo rumbo (el
                        agente reenvía su plan si cambió). También la ves llegar
                        en el chat.
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
                  {state === "pregunta" && (
                    <div className="mt-2">
                      <p className="mb-1 text-[10px] text-faint">
                        ¿Pidió material? Agrégale carpetas o archivos de
                        contexto (solo lectura; se suman a los que ya tiene):
                      </p>
                      <ContextPicker value={extraCtx} onChange={setExtraCtx} />
                    </div>
                  )}
                  <button
                    disabled={acting || !answer.trim()}
                    onClick={() =>
                      act(
                        () =>
                          answerQuestion({
                            sessionToken: token!,
                            taskId: task._id,
                            answer: answer.trim(),
                            ...(extraCtx.carpetas.length ||
                            extraCtx.archivos.length
                              ? {
                                  carpetas: extraCtx.carpetas,
                                  archivos: extraCtx.archivos,
                                }
                              : {}),
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

              {/* Modo plan: la fase de planificación corre en solo lectura */}
              {state === "planificando" && (
                <div
                  className="mb-4 rounded-el border-el p-3"
                  style={{
                    borderColor:
                      "color-mix(in srgb, var(--status-en-curso) 45%, transparent)",
                    background:
                      "color-mix(in srgb, var(--status-en-curso) 8%, transparent)",
                  }}
                >
                  <p className="text-xs font-semibold text-ink">
                    El agente está planificando…
                  </p>
                  <p className="mt-1 text-[11px] text-mute">
                    Corre en modo de solo lectura: no ejecuta ni modifica nada.
                    Al terminar verás su plan acá (pasos + detalle) para aprobar
                    o pedir cambios antes de que toque una sola línea.
                  </p>
                </div>
              )}

              {/* Modo plan: aprobar el plan o pedir cambios (replanifica) */}
              {canReviewPlan && (
                <div className="mb-4 rounded-el border-el border-line bg-panel2/50 p-3">
                  <p className="text-xs font-semibold text-ink">
                    Plan esperando tu OK
                  </p>
                  {planRun?.plan && planRun.plan.length > 0 && (
                    <ol className="mt-2 space-y-1">
                      {planRun.plan.map((p, i) => (
                        <li
                          key={i}
                          className="flex items-baseline gap-1.5 text-xs text-ink"
                        >
                          <span className="shrink-0 font-mono text-[10px] text-faint">
                            {i + 1}.
                          </span>
                          <span className="min-w-0">{p}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {planRun?.planDetail && (
                    <div className="mt-3 border-t border-line pt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">
                        Detalle de lo que va a hacer
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-mute">
                        {planRun.planDetail}
                      </p>
                    </div>
                  )}
                  {!planRun?.plan && !planRun?.planDetail && (
                    <p className="mt-2 text-[11px] text-mute">
                      El plan todavía no llegó — espera un momento y reabre.
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      disabled={acting}
                      onClick={() =>
                        act(
                          () =>
                            approvePlan({
                              sessionToken: token!,
                              taskId: task._id,
                            }),
                          "Plan aprobado: la tarea pasa a ejecución",
                        )
                      }
                      className="btn-primary inline-flex items-center gap-1.5 text-xs"
                    >
                      {acting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Aprobar y ejecutar
                    </button>
                    <button
                      disabled={acting || !feedback.trim()}
                      onClick={() =>
                        act(
                          () =>
                            requestPlanChanges({
                              sessionToken: token!,
                              taskId: task._id,
                              feedback: feedback.trim(),
                            }),
                          "Replanificando con tus indicaciones",
                        )
                      }
                      className="btn-ghost inline-flex items-center gap-1.5 border-el text-xs hover:text-ink"
                    >
                      <CornerDownRight className="h-3.5 w-3.5" />
                      Replanificar con estos cambios
                    </button>
                  </div>
                  <input
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Qué cambiar del plan (obligatorio para replanificar)…"
                    className="input mt-2 text-xs"
                  />
                  <p className="mt-1.5 text-[10px] text-faint">
                    Al aprobar, la ejecución retoma esta misma sesión (conserva
                    lo que ya exploró). Replanificar no ejecuta nada: solo rehace
                    el plan con tus indicaciones.
                  </p>
                </div>
              )}

              {/* Tarea de correo: la propuesta del agente, lista para copiar
                  y pegar en el cliente de correo (el envío es de Cris). */}
              {t.taskType === "correo" &&
                (() => {
                  const propuesta = runs.find((r) => r.summary && r.endedAt);
                  if (!propuesta) return null;
                  return (
                    <div className="mb-4 rounded-el border-el border-line bg-panel2/50 p-3">
                      <p className="text-xs font-semibold text-ink">
                        Propuesta de respuesta
                      </p>
                      <div className="mt-1.5 rounded-el border-el border-line bg-panel p-3">
                        <SummaryText text={propuesta.summary ?? ""} />
                      </div>
                      <button
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(propuesta.summary!)
                            .then(() =>
                              toast.success(
                                "Respuesta copiada: pégala en tu correo y envíala",
                              ),
                            );
                        }}
                        className="btn-primary mt-2 inline-flex items-center gap-1.5 text-xs"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copiar respuesta
                      </button>
                      <p className="mt-1.5 text-[10px] text-faint">
                        El agente nunca envía: revisa, copia, pega y envía tú.
                      </p>
                    </div>
                  );
                })()}

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

              {/* Artefactos: carpeta/reporte abribles desde el PC. Con la
                  tarea EN VIVO (t): la sesión se bindea a mitad de corrida y
                  con el snapshot el botón de chat no aparecía. */}
              <ArtifactsBlock
                task={t}
                plan={runs.find((r) => r.plan && r.plan.length > 0)?.plan}
                session={
                  t.agentSessionId ??
                  runs.find((r) => r.sessionId)?.sessionId
                }
                since={runs[0]?.startedAt}
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
                      {(() => {
                        // Agente de ESTA corrida (vacío en corridas viejas = zcode).
                        const rm = run.agent && run.agent !== "zcode" ? EXECUTOR_META[run.agent] : EXECUTOR_META.zcode;
                        return (
                          <span
                            className={cn("inline-flex items-center gap-1 font-semibold", rm.color)}
                            title={`Corrida ejecutada por ${rm.label}`}
                          >
                            <rm.Icon className="h-3 w-3" />
                            {rm.label.replace(" Code", "")}
                          </span>
                        );
                      })()}
                      <span title={new Date(run.startedAt).toLocaleString("es-CL")}>
                        {formatRelative(run.startedAt)}
                      </span>
                      {(() => {
                        const label = run.model ? agentModelLabel(run.model) : "";
                        return label ? <span>{label}</span> : null;
                      })()}
                      {run.resumed && <span>· seguimiento</span>}
                      <RunTiming run={run} queuedAt={t.agentQueuedAt} />
                      {run.sessionId && (
                        <span
                          className="inline-flex items-center gap-1"
                          title={`La lista de sesiones del desktop se refresca al reiniciarlo o cambiar de workspace; para abrirla ya mismo, reanudá con este id${
                            run.agent === "claude" ? " (claude --resume <id>)" : " (/resume <id> en ZCode)"
                          }`}
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
                                  run.agent === "claude"
                                    ? "sessionId copiado — claude --resume <id>"
                                    : "sessionId copiado — en ZCode: /resume <id>",
                                ),
                              );
                          }}
                          className="rounded p-0.5 text-faint transition-colors hover:bg-panel hover:text-ink"
                          title={
                            run.agent === "claude"
                              ? "Copiar sessionId (para claude --resume)"
                              : "Copiar sessionId (para /resume en ZCode)"
                          }
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
                      <StepList run={run} taskDone={taskDone} />
                    </div>
                    {run.followUp && (
                      <p className="mt-1 text-[11px] text-mute">
                        <span className="font-semibold">Contexto de Cris:</span>{" "}
                        {run.followUp}
                      </p>
                    )}
                  {run.summary && run.endedAt && (
                    <SummaryBlock title="Resultado del agente" text={run.summary} />
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
