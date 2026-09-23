/**
 * Delegación al agente dentro del TaskModal, agrupada por DIMENSIÓN (riel de
 * etiquetas a la izquierda): Trabajo (tipo) → Dónde (carpeta registrada o
 * propia, en el mismo lugar, + material de contexto) → Cómo (autonomía, plan,
 * git) → Avisos (WhatsApp). El modelo vive junto al selector de ejecutor
 * (AgentModelSelect). Solo con ejecutor despachable y en la web.
 *
 * Controlado desde TaskModal vía value/onChange para que hidrate/beba del
 * mismo borrador que el resto del formulario.
 */
import { useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import toast from "react-hot-toast";
import { Circle, CircleDot, Rocket, Compass } from "lucide-react";
import { api } from "~/convex/_generated/api";
import { useAuth } from "../hooks/useAuth";
import { useNativePicker } from "../hooks/useNativePicker";
import {
  TASK_TYPES,
  TASK_TYPE_META,
  AUTONOMIES,
  AUTONOMY_META,
  GIT_STRATEGIES,
  GIT_STRATEGY_META,
  NOTIFY_MODES,
  NOTIFY_META,
  AREA_META,
  EXECUTOR_META,
  type TaskType,
  type Autonomy,
  type GitStrategy,
  type NotifyMode,
  type Area,
  type DelegatedExecutor,
} from "../lib/constants";
import { AGENT_UI_ENABLED, cn } from "../lib/utils";

export interface AgentConfig {
  taskType: TaskType | "";
  workspaceId: string;
  /** Modo carpeta customizada: opción B bajo el selector de registradas. */
  customMode: boolean;
  /** Carpeta customizada (ruta absoluta): el agente trabaja ahí SIN git. */
  customFolder: string;
  /** Adjuntos del modo custom: se COPIAN a customFolder al despachar. */
  customArchivos: string[];
  autonomy: Autonomy;
  model: string;
  /** Estrategia Git (solo desarrollo): rama-pr default | main-directo; "solo-local" la fija el modo custom. */
  gitStrategy: GitStrategy;
  notifyWhatsapp: NotifyMode;
  /** Modo plan: primero planifica (solo lectura) y espera tu OK antes de ejecutar. */
  planMode: boolean;
}

export const EMPTY_AGENT_CONFIG: AgentConfig = {
  taskType: "",
  workspaceId: "",
  customMode: false,
  customFolder: "",
  customArchivos: [],
  autonomy: "supervisado",
  model: "",
  gitStrategy: "rama-pr",
  notifyWhatsapp: "off",
  planMode: false,
};

export function agentConfigFromTask(t: {
  taskType?: string;
  workspaceId?: string;
  workspacePath?: string;
  autonomy?: string;
  model?: string;
  gitStrategy?: string;
  notifyWhatsapp?: string;
  planMode?: boolean;
  archivos?: string[];
}): AgentConfig {
  // Modo customizada: ruta suelta sin workspace registrado + estrategia
  // solo-local (la única que produce ese par hoy).
  const customMode = t.gitStrategy === "solo-local" && !t.workspaceId;
  return {
    taskType: (TASK_TYPES as readonly string[]).includes(t.taskType ?? "")
      ? (t.taskType as TaskType)
      : "",
    workspaceId: t.workspaceId ?? "",
    customMode,
    customFolder: customMode ? (t.workspacePath ?? "") : "",
    customArchivos: customMode ? (t.archivos ?? []) : [],
    autonomy: (AUTONOMIES as readonly string[]).includes(t.autonomy ?? "")
      ? (t.autonomy as Autonomy)
      : "supervisado",
    model: t.model ?? "",
    gitStrategy:
      t.gitStrategy === "main-directo" || t.gitStrategy === "solo-local"
        ? t.gitStrategy
        : "rama-pr",
    notifyWhatsapp: (NOTIFY_MODES as readonly string[]).includes(t.notifyWhatsapp ?? "")
      ? (t.notifyWhatsapp as NotifyMode)
      : "off",
    planMode: t.planMode === true,
  };
}

/** Ruta absoluta de la carpeta elegida (para mostrarla; el despacho valida en disco). */
function workspaceLabel(
  ws: { label: string; path: string; area: string; vcs: string } | undefined,
): string {
  if (!ws) return "";
  return `${ws.path} · ${ws.vcs === "git" ? "Git" : "local (sin git)"}`;
}

/**
 * Contexto adicional (solo lectura) colapsable: una carpeta DISTINTA de la
 * destino o archivos que están en otro lado del disco. Cerrado por defecto
 * para no sumar un tercer selector de carpeta al modal; si la tarea ya trae
 * contexto (edición), arranca abierto para no esconder contenido existente.
 */
function ContextoAdicional({
  count = 0,
  children,
}: {
  count?: number;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(count > 0);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-el border-el border-line px-2 py-1.5 text-[11px] font-medium text-ink transition-colors hover:bg-panel2"
      >
        <span>{open ? "−" : "＋"} Contexto adicional</span>
        <span className="min-w-0 truncate text-[10px] font-normal text-faint">
          {open
            ? "carpetas o archivos de otro lado · solo lectura"
            : count > 0
              ? `${count} ${count === 1 ? "ítem listo" : "ítems listos"} · carpetas o archivos de otro lado`
              : "carpeta distinta de la destino, o archivos de otro lado"}
        </span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function AgentDelegationSection({
  value,
  onChange,
  executor,
  contextSlot,
  contextCount = 0,
  correoOrigen = false,
}: {
  value: AgentConfig;
  onChange: (next: AgentConfig) => void;
  area: Area;
  /** Agente despachable elegido (ZCode o Claude Code). */
  executor: DelegatedExecutor;
  /** Bloque extra al final de la sección (respuesta del correo). */
  contextSlot?: ReactNode;
  /** Ítems de contexto ya elegidos (carpetas+archivos): arranca abierto si >0. */
  contextCount?: number;
  /** La tarea nació de un correo: habilita el tipo "Correo". */
  correoOrigen?: boolean;
}) {
  if (!AGENT_UI_ENABLED) return null;
  const { token } = useAuth();

  const workspaces =
    useQuery(
      api.agent.listWorkspaces,
      token ? { sessionToken: token } : "skip",
    ) ?? [];
  const bridge = useQuery(
    api.agent.bridgeStatus,
    token ? { sessionToken: token } : "skip",
  );

  // Picker nativo del modo customizada: carpeta (se puede crear en el
  // diálogo) + archivos que se copiarán adentro al despachar.
  const picker = useNativePicker(
    (kind, paths) => {
      if (!paths.length) return;
      if (kind === "folder") {
        onChange({ ...value, customFolder: paths[0] });
      } else {
        onChange({
          ...value,
          customArchivos: [...new Set([...value.customArchivos, ...paths])],
        });
      }
    },
    (reason) => {
      if (reason === "timeout") toast.error("El selector de Windows no respondió. Revisa que el protocolo hermesagent esté instalado, o escribe la ruta a mano.");
    },
  );

  // Acento del agente: fucsia ZCode, naranja Claude.
  const accent =
    executor === "claude"
      ? {
          text: "text-orange-500 dark:text-orange-400",
          border: "border-orange-500/60",
          bg: "bg-orange-500/10",
        }
      : {
          text: "text-fuchsia-500 dark:text-fuchsia-400",
          border: "border-fuchsia-500/60",
          bg: "bg-fuchsia-500/10",
        };

  const typeMeta = value.taskType ? TASK_TYPE_META[value.taskType] : null;
  // Separación explícita por MUNDO (CONTRATO_AGENTE.md §4): el selector muestra
  // ambos grupos separados; las carpetas del mundo incompatible con el tipo
  // elegido aparecen deshabilitadas (así la regla se ve, no se adivina).
  const enabled = workspaces.filter((w) => w.enabled);
  // Orden alfabético dentro de cada grupo: si no, el selector mezclaba las
  // carpetas en el orden que las sembró la base (pedido explícito de Cris).
  const byLabel = (a: { label: string }, b: { label: string }) =>
    a.label.localeCompare(b.label, "es", { sensitivity: "base" });
  const devGroup = enabled.filter((w) => w.vcs === "git").sort(byLabel);
  const repGroup = enabled.filter((w) => w.vcs === "ninguno").sort(byLabel);
  const isAllowed = (w: { vcs: string }) =>
    !typeMeta?.vcs || w.vcs === typeMeta.vcs;
  const chosen = workspaces.find((w) => w._id === value.workspaceId);
  // Carpeta: una sola decisión con dos formas (registrada | propia) que
  // comparten el MISMO lugar; el material de contexto va justo debajo.
  const setFolderMode = (custom: boolean) => {
    if (custom === value.customMode) return;
    onChange(
      custom
        ? // Carpeta propia: sin carpeta registrada y estrategia fija
          // solo-local (sin git).
          { ...value, customMode: true, workspaceId: "", gitStrategy: "solo-local" }
        : // Volver a la registrada: soltar lo custom y restablecer la
          // estrategia por defecto.
          { ...value, customMode: false, customFolder: "", customArchivos: [], gitStrategy: "rama-pr" },
    );
  };
  const isCorreo = value.taskType === "correo";
  const pathInvalid =
    !!value.customFolder && !/^([a-zA-Z]:\\|\\\\)/.test(value.customFolder.trim());

  return (
    <div className="divide-y divide-line border-t border-line">
      {/* Modelo: pegado al agente elegido arriba (el catálogo depende de él). */}
      <Dim label="Modelo" hint={`de ${EXECUTOR_META[executor].label}`}>
        <AgentModelSelect
          executor={executor}
          value={value.model}
          onChange={(model) => onChange({ ...value, model })}
        />
      </Dim>

      {/* Trabajo: el tipo decide el mundo (Git vs archivos) y las reglas. */}
      <Dim label="Trabajo" hint="Define reglas y carpetas válidas">
        <div
          role="radiogroup"
          aria-label="Tipo de trabajo"
          className="grid grid-cols-3 gap-1 sm:grid-cols-6"
        >
          {TASK_TYPES.map((t) => {
            const meta = TASK_TYPE_META[t];
            const active = value.taskType === t;
            // El tipo Correo solo aplica a tareas de origen correo (traen el
            // correo completo para el prompt de la respuesta).
            const bloqueado = t === "correo" && !correoOrigen;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={bloqueado}
                title={bloqueado ? "Solo para tareas que nacieron de un correo marcado" : meta.hint}
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
                  "flex flex-col items-center gap-1 rounded-el border-el px-1 py-2 text-[10px] font-medium transition-colors",
                  active ? cn(accent.border, accent.bg, "text-ink") : "border-line text-mute hover:bg-panel2",
                  bloqueado && "cursor-not-allowed opacity-40 hover:bg-transparent",
                )}
              >
                <meta.Icon className={cn("h-4 w-4", active && accent.text)} />
                {meta.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-faint">
          {typeMeta ? (
            <>
              {typeMeta.hint}
              {typeMeta.vcs === "ninguno" && " · prohibido git: ni .md ni .pbix se versionan"}
              {typeMeta.vcs === "git" && " · rama agent/*, nunca master"}
            </>
          ) : (
            "Elige qué tipo de trabajo es."
          )}
        </p>
      </Dim>

      {/* Dónde: carpeta de trabajo (registrada o propia) + contexto. */}
      <Dim
        label={isCorreo ? "Contexto" : "Dónde"}
        hint={isCorreo ? "El agente no escribe: redacta" : "Carpeta y material"}
      >
        {!isCorreo && (
          <>
            <div
              role="radiogroup"
              aria-label="Carpeta de trabajo"
              className="mb-2 inline-flex w-full rounded-el border-el border-line p-0.5 sm:w-auto"
            >
              {[
                { custom: false, label: "Carpeta registrada", sub: "repos y reportes" },
                { custom: true, label: "Carpeta propia", sub: "local, sin git" },
              ].map((opt) => {
                const active = value.customMode === opt.custom;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setFolderMode(opt.custom)}
                    className={cn(
                      "flex-1 rounded-[calc(var(--radius)-2px)] px-3 py-1.5 text-left text-xs transition-colors sm:flex-none",
                      active ? cn(accent.bg, "text-ink") : "text-mute hover:text-ink",
                    )}
                  >
                    <span className="font-semibold">{opt.label}</span>
                    <span className="ml-1.5 hidden text-[10px] text-faint sm:inline">{opt.sub}</span>
                  </button>
                );
              })}
            </div>

            {!value.customMode ? (
              <>
                <select
                  value={value.workspaceId}
                  onChange={(e) => onChange({ ...value, workspaceId: e.target.value })}
                  className="input"
                  aria-label={`Carpeta registrada${typeMeta?.vcs ? " (obligatoria)" : ""}`}
                >
                  <option value="">
                    {typeMeta?.vcs === "git"
                      ? "Elige el repo Git…"
                      : typeMeta?.vcs === "ninguno"
                        ? "Elige la carpeta del reporte…"
                        : "Elige la carpeta donde trabaja…"}
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
                  <p className="mt-1 truncate font-mono text-[10px] text-faint" title={chosen.path}>
                    {workspaceLabel(chosen)}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="flex gap-1.5">
                  <input
                    value={value.customFolder}
                    onChange={(e) => onChange({ ...value, customFolder: e.target.value })}
                    placeholder="C:\proyectos\mi-carpeta"
                    spellCheck={false}
                    className="input min-w-0 flex-1 font-mono text-xs"
                    aria-label="Ruta de la carpeta propia"
                    aria-invalid={pathInvalid}
                  />
                  <button
                    type="button"
                    disabled={picker.esperando}
                    onClick={() => picker.abrir("folder")}
                    className="btn-secondary shrink-0 px-2.5 text-xs"
                    title="Abre el diálogo de Windows (puedes crear la carpeta ahí mismo)"
                  >
                    {picker.esperando ? "Eligiendo…" : "Elegir…"}
                  </button>
                </div>
                <p
                  className={cn(
                    "mt-1 text-[10px] leading-snug",
                    pathInvalid ? "text-amber-600 dark:text-amber-400" : "text-faint",
                  )}
                >
                  {pathInvalid
                    ? "Debe ser una ruta absoluta de este PC (C:\\… o \\\\servidor\\…)."
                    : picker.esperando
                      ? "Se abrió el diálogo de Windows: elige o crea la carpeta."
                      : "Pega la ruta o elígela — si no existe, se crea al despachar. Sin git: nada se versiona ni sube."}
                </p>
              </>
            )}
          </>
        )}

        {/* Material de contexto: justo debajo de la carpeta. */}
        <div className={cn(!isCorreo && "mt-3")}>
          {value.customMode && !isCorreo ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-ink">Archivos para el agente</p>
                <button
                  type="button"
                  disabled={picker.esperando}
                  onClick={() => picker.abrir("files")}
                  className="rounded-el border-el border-line px-2 py-1 text-[10px] font-medium text-ink hover:bg-panel2 disabled:opacity-50"
                >
                  + Agregar archivos…
                </button>
              </div>
              {value.customArchivos.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {value.customArchivos.map((a) => (
                    <span
                      key={a}
                      title={a}
                      className="inline-flex max-w-full items-center gap-1 rounded-el border-el border-line bg-panel2 px-1.5 py-0.5 font-mono text-[10px] text-ink"
                    >
                      <span className="truncate">{a.split(/[\\/]/).pop()}</span>
                      <button
                        type="button"
                        aria-label={`Quitar ${a.split(/[\\/]/).pop()}`}
                        onClick={() =>
                          onChange({
                            ...value,
                            customArchivos: value.customArchivos.filter((x) => x !== a),
                          })
                        }
                        className="shrink-0 text-faint hover:text-ink"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <p className="mt-1 text-[10px] leading-snug text-faint">
                Se copian dentro de la carpeta al despachar; los originales quedan donde están.
              </p>
            </>
          ) : isCorreo ? (
            contextSlot
          ) : (
            <ContextoAdicional count={contextCount}>{contextSlot}</ContextoAdicional>
          )}
        </div>
      </Dim>

      {/* Cómo: autonomía, plan antes de ejecutar y (si aplica) git. */}
      <Dim label="Cómo" hint="Cuánto decide solo">
        <div
          role="radiogroup"
          aria-label="Autonomía"
          className="grid grid-cols-1 gap-1.5 sm:grid-cols-3"
        >
          {AUTONOMIES.map((a) => {
            const meta = AUTONOMY_META[a];
            const active = value.autonomy === a;
            return (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange({ ...value, autonomy: a })}
                className={cn(
                  "flex flex-col gap-0.5 rounded-el border-el p-2 text-left transition-colors",
                  active ? cn(accent.border, accent.bg) : "border-line hover:bg-panel2",
                )}
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                  <meta.Icon className={cn("h-3.5 w-3.5", active && accent.text)} />
                  {meta.label}
                </span>
                <span className="text-[10px] leading-snug text-mute">{meta.desc}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div role="radiogroup" aria-label="Modo de ejecución" className="inline-flex rounded-el border-el border-line p-0.5">
            {[
              { plan: false, label: "Directo", Icon: Rocket },
              { plan: true, label: "Plan primero", Icon: Compass },
            ].map((opt) => {
              const active = value.planMode === opt.plan;
              return (
                <button
                  key={opt.label}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange({ ...value, planMode: opt.plan })}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-[calc(var(--radius)-2px)] px-2.5 py-1 text-xs font-medium transition-colors",
                    active ? cn(accent.bg, "text-ink") : "text-mute hover:text-ink",
                  )}
                >
                  <opt.Icon className={cn("h-3.5 w-3.5", active && accent.text)} />
                  {opt.label}
                </button>
              );
            })}
          </div>
          <span className="text-[10px] leading-snug text-faint">
            {value.planMode
              ? "Planifica en solo lectura y espera tu OK antes de ejecutar."
              : "Planifica y ejecuta de una: revisas el resultado al final."}
          </span>
        </div>

        {/* Estrategia de Git: desarrollo y ops, con carpeta registrada (la
            propia queda fija en solo-local). */}
        {(value.taskType === "desarrollo" || value.taskType === "ops") && !value.customMode && (
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] font-semibold text-ink">Git</p>
            <div role="radiogroup" aria-label="Estrategia de Git" className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {GIT_STRATEGIES.map((g) => {
                const meta = GIT_STRATEGY_META[g];
                const active = value.gitStrategy === g;
                const danger = g === "main-directo";
                return (
                  <button
                    key={g}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    title={meta.desc}
                    onClick={() => onChange({ ...value, gitStrategy: g })}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-el border-el p-2 text-left transition-colors",
                      active
                        ? danger
                          ? "border-red-500/60 bg-red-500/10"
                          : cn(accent.border, accent.bg)
                        : "border-line hover:bg-panel2",
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                      <meta.Icon className={cn("h-3.5 w-3.5", active && (danger ? "text-red-500" : accent.text))} />
                      {meta.label}
                    </span>
                    <span className="text-[10px] leading-snug text-mute">
                      {meta.desc}
                      {danger && " ⚠ Se publica a producción al pushear."}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Dim>

      {/* Avisos por WhatsApp (vía Hermes). */}
      <Dim label="Avisos" hint="WhatsApp vía Hermes">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div role="radiogroup" aria-label="Avisos por WhatsApp" className="inline-flex rounded-el border-el border-line p-0.5">
            {NOTIFY_MODES.map((n) => {
              const active = value.notifyWhatsapp === n;
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange({ ...value, notifyWhatsapp: n })}
                  className={cn(
                    "rounded-[calc(var(--radius)-2px)] px-2.5 py-1 text-xs font-medium transition-colors",
                    active ? "bg-emerald-500/15 text-ink" : "text-mute hover:text-ink",
                  )}
                >
                  {NOTIFY_META[n].label}
                </button>
              );
            })}
          </div>
          <span className="text-[10px] leading-snug text-faint">{NOTIFY_META[value.notifyWhatsapp].desc}</span>
        </div>
      </Dim>

      {/* Estado del puente: qué pasa al guardar. */}
      <p className="flex items-center gap-1.5 pt-3 text-[10px] text-faint">
        {bridge?.active ? (
          <>
            <CircleDot className="h-3 w-3 shrink-0 text-emerald-500" />
            {(bridge.activeRuns ?? []).length > 0
              ? `Puente activo con ${bridge.activeRuns.length} corrida${bridge.activeRuns.length > 1 ? "s" : ""}: tu tarea sale en cuanto haya espacio${(bridge.queueDepth ?? 0) > 0 ? ` (${bridge.queueDepth} en cola)` : ""}.`
              : "Puente activo: se despacha en segundos al guardar."}
          </>
        ) : (
          <>
            <Circle className="h-3 w-3 shrink-0" />
            Puente apagado: quedará en cola y saldrá al encender el puente.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Fila de dimensión: nombre corto a la izquierda (riel) y controles a la
 * derecha; en pantallas chicas se apila. Las filas se separan con una línea
 * (divide-y del contenedor), sin tarjetas anidadas.
 */
function Dim({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 py-3 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-4">
      <div className="sm:pt-1">
        <p className="text-xs font-semibold text-ink">{label}</p>
        {hint && <p className="text-[10px] leading-snug text-faint">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Modelo del agente: vive junto al selector de ejecutor (el catálogo depende
 * del agente elegido). Sin modelo = el default de su config.
 */
export function AgentModelSelect({
  executor,
  value,
  onChange,
}: {
  executor: DelegatedExecutor;
  value: string;
  onChange: (model: string) => void;
}) {
  const { token } = useAuth();
  const models = useQuery(
    api.agent.listModels,
    token ? { sessionToken: token, agent: executor } : "skip",
  );
  const modelList = models?.models ?? [];
  const defaultModel = models?.default ?? "";
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="input"
      aria-label={`Modelo de ${EXECUTOR_META[executor].label}`}
    >
      <option value="">
        {defaultModel ? `Default (${defaultModel.split("/").pop()})` : "Default de su config"}
      </option>
      {modelList.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
