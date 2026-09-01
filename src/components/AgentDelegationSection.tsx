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
  area,
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
  // Separación dura (CONTRATO_AGENTE.md §4): el tipo filtra las carpetas.
  const candidates = workspaces.filter(
    (w) =>
      w.enabled &&
      (!typeMeta?.vcs || w.vcs === typeMeta.vcs) &&
      (!w.types?.length || !value.taskType || w.types.includes(value.taskType)),
  );
  const inArea = candidates.filter((w) => w.area === area);
  const rest = candidates.filter((w) => w.area !== area);
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

      {/* Carpeta destino (obligatoria para reporte/desarrollo) */}
      {typeMeta?.vcs && (
        <>
          <label className="label">
            Carpeta destino {typeMeta.vcs === "git" ? "(repo Git)" : "(reporte)"} *
          </label>
          <select
            value={value.workspaceId}
            onChange={(e) => onChange({ ...value, workspaceId: e.target.value })}
            className="input mb-1"
          >
            <option value="">Elegí carpeta…</option>
            {inArea.length > 0 && (
              <optgroup label={area === "patagonia" ? "Patagonia" : area === "datacef" ? "Datacef" : "Personal"}>
                {inArea.map((w) => (
                  <option key={w._id} value={w._id}>
                    {w.label}
                  </option>
                ))}
              </optgroup>
            )}
            {rest.length > 0 && (
              <optgroup label="Otras áreas">
                {rest.map((w) => (
                  <option key={w._id} value={w._id}>
                    {w.label}
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
        </>
      )}

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

      {/* Estado del puente: si está apagado la tarea queda encolada igual. */}
      <p className="mt-2.5 flex items-center gap-1.5 text-[10px] text-faint">
        {bridge?.active ? (
          <>
            <CircleDot className="h-3 w-3 text-emerald-500" />
            Puente activo — se despacha en segundos al guardar
          </>
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
