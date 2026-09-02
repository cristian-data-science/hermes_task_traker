/**
 * Bloque "Delegación a ZCode" del TaskModal: tipo de tarea → carpeta destino
 * (con la separación dura Git vs archivos), nivel de autonomía, modelo y
 * notificaciones WhatsApp. Solo se muestra con ejecutor ZCode y en la web
 * (AGENT_UI_ENABLED).
 *
 * Controlado desde TaskModal vía value/onChange para que hidrate/beba del
 * mismo borrador que el resto del formulario.
 */
import { useQuery } from "convex/react";
import {
  Sparkles,
  Circle,
  CircleDot,
} from "lucide-react";
import { api } from "~/convex/_generated/api";
import { useAuth } from "../hooks/useAuth";
import {
  TASK_TYPES,
  TASK_TYPE_META,
  AUTONOMIES,
  AUTONOMY_META,
  NOTIFY_MODES,
  NOTIFY_META,
  AREA_META,
  type TaskType,
  type Autonomy,
  type NotifyMode,
  type Area,
} from "../lib/constants";
import { AGENT_UI_ENABLED, cn } from "../lib/utils";

export interface AgentConfig {
  taskType: TaskType | "";
  workspaceId: string;
  autonomy: Autonomy;
  model: string;
  notifyWhatsapp: NotifyMode;
}

export const EMPTY_AGENT_CONFIG: AgentConfig = {
  taskType: "",
  workspaceId: "",
  autonomy: "supervisado",
  model: "",
  notifyWhatsapp: "off",
};

export function agentConfigFromTask(t: {
  taskType?: string;
  workspaceId?: string;
  autonomy?: string;
  model?: string;
  notifyWhatsapp?: string;
}): AgentConfig {
  return {
    taskType: (TASK_TYPES as readonly string[]).includes(t.taskType ?? "")
      ? (t.taskType as TaskType)
      : "",
    workspaceId: t.workspaceId ?? "",
    autonomy: (AUTONOMIES as readonly string[]).includes(t.autonomy ?? "")
      ? (t.autonomy as Autonomy)
      : "supervisado",
    model: t.model ?? "",
    notifyWhatsapp: (NOTIFY_MODES as readonly string[]).includes(t.notifyWhatsapp ?? "")
      ? (t.notifyWhatsapp as NotifyMode)
      : "off",
  };
}

/** Ruta absoluta de la carpeta elegida (para mostrarla; el despacho valida en disco). */
function workspaceLabel(
  ws: { label: string; path: string; area: string; vcs: string } | undefined,
): string {
  if (!ws) return "";
  return `${ws.path} · ${ws.vcs === "git" ? "Git" : "local (sin git)"}`;
}

export function AgentDelegationSection({
  value,
  onChange,
}: {
  value: AgentConfig;
  onChange: (next: AgentConfig) => void;
  area: Area;
}) {
  if (!AGENT_UI_ENABLED) return null;
  const { token } = useAuth();

  const workspaces =
    useQuery(
      api.agent.listWorkspaces,
      token ? { sessionToken: token } : "skip",
    ) ?? [];
  const models =
    useQuery(api.agent.listModels, token ? { sessionToken: token } : "skip");
  const bridge = useQuery(
    api.agent.bridgeStatus,
    token ? { sessionToken: token } : "skip",
  );

  const typeMeta = value.taskType ? TASK_TYPE_META[value.taskType] : null;
  // Separación explícita por MUNDO (CONTRATO_AGENTE.md §4): el selector muestra
  // ambos grupos separados; las carpetas del mundo incompatible con el tipo
  // elegido aparecen deshabilitadas (así la regla se ve, no se adivina).
  const enabled = workspaces.filter((w) => w.enabled);
  const devGroup = enabled.filter((w) => w.vcs === "git");
  const repGroup = enabled.filter((w) => w.vcs === "ninguno");
  const isAllowed = (w: { vcs: string }) =>
    !typeMeta?.vcs || w.vcs === typeMeta.vcs;
  const chosen = workspaces.find((w) => w._id === value.workspaceId);
  const modelList = models?.models ?? [];
  const defaultModel = models?.default ?? "";

  return (
    <div className="mb-4 rounded-el border-el border-line bg-panel2/50 p-3">
      <div className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-ink">
        <Sparkles className="h-3.5 w-3.5 text-fuchsia-500 dark:text-fuchsia-400" />
        Delegación a ZCode
      </div>

      {/* Tipo de tarea */}
      <label className="label">Tipo de tarea</label>
      <div className="mb-3 grid grid-cols-5 gap-1">
        {TASK_TYPES.map((t) => {
          const meta = TASK_TYPE_META[t];
          const active = value.taskType === t;
          return (
            <button
              key={t}
              type="button"
              title={meta.hint}
              onClick={() => {
                // Si la carpeta elegida no sirve para el nuevo tipo, soltarla.
                const newMeta = TASK_TYPE_META[t];
                const stillValid = workspaces.some(
                  (w) =>
                    w._id === value.workspaceId &&
                    w.enabled &&
                    (!newMeta.vcs || w.vcs === newMeta.vcs),
                );
                onChange({ ...value, taskType: t, workspaceId: stillValid ? value.workspaceId : "" });
              }}
              className={cn(
                "flex flex-col items-center gap-1 rounded-el border-el px-1 py-2 text-[10px] font-medium transition-all",
                active
                  ? "border-fuchsia-500/60 bg-fuchsia-500/10 text-ink"
                  : "border-line text-mute hover:bg-panel2",
              )}
            >
              <meta.Icon
                className={cn("h-4 w-4", active && "text-fuchsia-500 dark:text-fuchsia-400")}
              />
              {meta.label}
            </button>
          );
        })}
      </div>
      {typeMeta && (
        <p className="mb-3 text-[11px] leading-snug text-faint">
          {typeMeta.hint}
          {typeMeta.vcs === "ninguno" &&
            " · prohibido git: ni .md ni .pbix se versionan"}
          {typeMeta.vcs === "git" && " · rama agent/*, nunca master"}
        </p>
      )}

      {/* Carpeta destino: obligatoria para reporte/desarrollo (mundos Git vs
          archivos); recomendada para el resto (el despachador la exige para
          saber dónde trabajar). */}
      <label className="label">
        Carpeta destino
        {typeMeta?.vcs === "git" && " (repo Git) *"}
        {typeMeta?.vcs === "ninguno" && " (reporte) *"}
      </label>
      <select
        value={value.workspaceId}
        onChange={(e) => onChange({ ...value, workspaceId: e.target.value })}
        className="input mb-1"
      >
        <option value="">
          {typeMeta?.vcs ? "Elige carpeta…" : "Elige carpeta (el agente trabaja ahí)…"}
        </option>
        {repGroup.length > 0 && (
          <optgroup label="📊 Reportes — carpetas locales (sin git)">
            {repGroup.map((w) => (
              <option key={w._id} value={w._id} disabled={!isAllowed(w)}>
                {w.label} · {AREA_META[w.area as Area]?.label ?? w.area}
                {!isAllowed(w) ? " (no aplica a este tipo)" : ""}
              </option>
            ))}
          </optgroup>
        )}
        {devGroup.length > 0 && (
          <optgroup label="🔀 Desarrollo — repos Git">
            {devGroup.map((w) => (
              <option key={w._id} value={w._id} disabled={!isAllowed(w)}>
                {w.label} · {AREA_META[w.area as Area]?.label ?? w.area}
                {!isAllowed(w) ? " (no aplica a este tipo)" : ""}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {chosen && (
        <p className="mb-3 truncate font-mono text-[10px] text-faint" title={chosen.path}>
          {workspaceLabel(chosen)}
        </p>
      )}
      {!chosen && <div className="mb-3" />}

      {/* Autonomía */}
      <label className="label">Autonomía</label>
      <div className="mb-3 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        {AUTONOMIES.map((a) => {
          const meta = AUTONOMY_META[a];
          const active = value.autonomy === a;
          return (
            <button
              key={a}
              type="button"
              onClick={() => onChange({ ...value, autonomy: a })}
              className={cn(
                "flex flex-col gap-1 rounded-el border-el p-2 text-left transition-all",
                active
                  ? "border-fuchsia-500/60 bg-fuchsia-500/10"
                  : "border-line hover:bg-panel2",
              )}
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                <meta.Icon
                  className={cn(
                    "h-3.5 w-3.5",
                    active && "text-fuchsia-500 dark:text-fuchsia-400",
                  )}
                />
                {meta.label}
              </span>
              <span className="text-[10px] leading-snug text-mute">{meta.desc}</span>
            </button>
          );
        })}
      </div>

      {/* Modelo + WhatsApp */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Modelo</label>
          <select
            value={value.model}
            onChange={(e) => onChange({ ...value, model: e.target.value })}
            className="input"
          >
            <option value="">
              {defaultModel
                ? `Default de tu config (${defaultModel.split("/").pop()})`
                : "Default de tu config"}
            </option>
            {modelList.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">WhatsApp (vía Hermes)</label>
          <div className="flex gap-1">
            {NOTIFY_MODES.map((n) => {
              const active = value.notifyWhatsapp === n;
              return (
                <button
                  key={n}
                  type="button"
                  title={NOTIFY_META[n].desc}
                  onClick={() => onChange({ ...value, notifyWhatsapp: n })}
                  className={cn(
                    "flex-1 rounded-el border-el px-1 py-1.5 text-[10px] font-medium transition-all",
                    active
                      ? "border-emerald-500/60 bg-emerald-500/10 text-ink"
                      : "border-line text-mute hover:bg-panel2",
                  )}
                >
                  {NOTIFY_META[n].label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Estado del puente: activo/libre/ocupado/apagado, con motivo. */}
      <p className="mt-2.5 flex items-center gap-1.5 text-[10px] text-faint">
        {bridge?.active ? (
          (bridge.activeRuns ?? []).length > 0 ? (
            <>
              <CircleDot className="h-3 w-3 text-emerald-500" />
              Puente activo pero ocupado con "{bridge.activeRuns[0].title}" (
              {bridge.activeRuns[0].elapsedMin} min) — tu tarea sale al liberar
              {(bridge.queueDepth ?? 0) > 0 && ` (${bridge.queueDepth} en cola)`}
            </>
          ) : (
            <>
              <CircleDot className="h-3 w-3 text-emerald-500" />
              Puente activo — se despacha en segundos al guardar
            </>
          )
        ) : (
          <>
            <Circle className="h-3 w-3" />
            Puente apagado — quedará encolada y saldrá al encender el puente
          </>
        )}
      </p>
    </div>
  );
}
