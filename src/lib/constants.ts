/**
 * Constantes compartidas: áreas, estados y su metadata visual.
 * Sin emojis: iconos Lucide + colores tonales por tema (CSS variables).
 */
import {
  Mountain,
  Building2,
  Home,
  Flame,
  Clock3,
  CirclePause,
  CalendarClock,
  CheckCircle2,
  UserRound,
  Bot,
  Sparkles,
  ChartColumn,
  GitBranch,
  Search,
  Server,
  ListTodo,
  Compass,
  ShieldCheck,
  Rocket,
  Inbox,
  Send,
  Loader2,
  HelpCircle,
  Eye,
  AlertTriangle,
  XCircle,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import { EnCursoIcon } from "../components/EnCursoIcon";

export const AREAS = ["patagonia", "datacef", "personal"] as const;
export type Area = (typeof AREAS)[number];

/** Ejecutores disponibles: Cris (tú), Claw (agente Hermes) o ZCode (agente de código). */
export const EXECUTORS = ["cris", "claw", "zcode"] as const;
export type Executor = (typeof EXECUTORS)[number];

export const EXECUTOR_META: Record<
  Executor,
  { label: string; Icon: LucideIcon; color: string }
> = {
  cris: {
    label: "Cris",
    Icon: UserRound,
    color: "text-indigo-600 dark:text-indigo-400",
  },
  claw: {
    label: "Claw",
    Icon: Bot,
    color: "text-amber-600 dark:text-amber-400",
  },
  zcode: {
    label: "ZCode",
    Icon: Sparkles,
    color: "text-fuchsia-600 dark:text-fuchsia-400",
  },
};

// ===== Capa agente (delegación Cris ⇄ ZCode; CONTRATO_AGENTE.md) =====

/** Tipos de tarea delegable; determinan el mundo de trabajo (Git vs archivos). */
export const TASK_TYPES = [
  "reporte",
  "desarrollo",
  "analisis",
  "ops",
  "otro",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_TYPE_META: Record<
  TaskType,
  { label: string; hint: string; Icon: LucideIcon; vcs: "git" | "ninguno" | null }
> = {
  reporte: {
    label: "Reporte",
    hint: "Power BI · carpeta local de mcp_servers, sin git",
    Icon: ChartColumn,
    vcs: "ninguno",
  },
  desarrollo: {
    label: "Desarrollo",
    hint: "Repo Git de git_provisorio, rama propia",
    Icon: GitBranch,
    vcs: "git",
  },
  analisis: { label: "Análisis", hint: "Investigar y medir sin cambiar nada", Icon: Search, vcs: null },
  ops: { label: "Ops", hint: "Solo lecturas/diagnóstico de infraestructura", Icon: Server, vcs: null },
  otro: { label: "Otro", hint: "Instrucciones de la tarea", Icon: ListTodo, vcs: null },
};

/** Niveles de autonomía del agente. */
export const AUTONOMIES = ["escenario", "supervisado", "autonomo"] as const;
export type Autonomy = (typeof AUTONOMIES)[number];

export const AUTONOMY_META: Record<
  Autonomy,
  { label: string; desc: string; Icon: LucideIcon }
> = {
  escenario: {
    label: "Escenario",
    desc: "Solo prepara bases: plan, stubs, rama o backup. Seguís pilotando vos.",
    Icon: Compass,
  },
  supervisado: {
    label: "Supervisado",
    desc: "Implementa y verifica. Nada se publica: espera tu revisión.",
    Icon: ShieldCheck,
  },
  autonomo: {
    label: "Autónomo",
    desc: "Todo + push de rama (nunca master). Prod/ERP/correos siempre con tu OK.",
    Icon: Rocket,
  },
};

/** Ciclo de vida de la delegación (fuente de verdad del lado agente). */
export const AGENT_STATES = [
  "encolada",
  "despachada",
  "trabajando",
  "pregunta",
  "para-revision",
  "hecho",
  "error",
  "cancelada",
] as const;
export type AgentState = (typeof AGENT_STATES)[number];

/** `tone` reutiliza las CSS variables de estados del tablero (mapeo §2 del contrato). */
export const AGENT_STATE_META: Record<
  AgentState,
  { label: string; Icon: LucideIcon; tone: string; pulse?: boolean }
> = {
  encolada: { label: "En cola", Icon: Inbox, tone: "var(--status-pendiente)" },
  despachada: { label: "Despachada", Icon: Send, tone: "var(--status-en-curso)" },
  trabajando: { label: "Trabajando", Icon: Loader2, tone: "var(--status-en-curso)", pulse: true },
  pregunta: { label: "Pregunta", Icon: HelpCircle, tone: "var(--status-urgente)", pulse: true },
  "para-revision": { label: "Para revisión", Icon: Eye, tone: "var(--status-standby)" },
  hecho: { label: "Hecho", Icon: CheckCircle2, tone: "var(--status-completado)" },
  error: { label: "Error", Icon: AlertTriangle, tone: "var(--status-urgente)", pulse: true },
  cancelada: { label: "Cancelada", Icon: XCircle, tone: "var(--muted)" },
};

/** Modos de notificación WhatsApp (vía Hermes). */
export const NOTIFY_MODES = ["off", "final", "periodica"] as const;
export type NotifyMode = (typeof NOTIFY_MODES)[number];

export const NOTIFY_META: Record<NotifyMode, { label: string; desc: string }> = {
  off: { label: "Sin avisos", desc: "Sin mensajes; todo vive en la app" },
  final: { label: "Solo resultado", desc: "Un mensaje al terminar (o si pregunta/falla)" },
  periodica: { label: "Periódicas", desc: "Inicio, avances, nudges y resultado" },
};

export const STATUSES = [
  "urgente",
  "pendiente",
  "en-curso",
  "standby",
  "programado",
  "completado",
] as const;
export type Status = (typeof STATUSES)[number];

/** Metadata visual de cada área. `tone` es la CSS variable del color. */
export const AREA_META: Record<
  Area,
  { label: string; Icon: LucideIcon; tone: string }
> = {
  patagonia: {
    label: "Patagonia",
    Icon: Mountain,
    tone: "var(--area-patagonia)",
  },
  datacef: {
    label: "Datacef",
    Icon: Building2,
    tone: "var(--area-datacef)",
  },
  personal: {
    label: "Personal",
    Icon: Home,
    tone: "var(--area-personal)",
  },
};

/** Metadata visual de cada estado. `tone` es la CSS variable del color. */
export const STATUS_META: Record<
  Status,
  { label: string; Icon: React.ComponentType<LucideProps>; tone: string }
> = {
  urgente: {
    label: "Urgente",
    Icon: Flame,
    tone: "var(--status-urgente)",
  },
  pendiente: {
    label: "Pendiente",
    Icon: Clock3,
    tone: "var(--status-pendiente)",
  },
  "en-curso": {
    label: "En curso",
    Icon: EnCursoIcon,
    tone: "var(--status-en-curso)",
  },
  standby: {
    label: "Standby",
    Icon: CirclePause,
    tone: "var(--status-standby)",
  },
  programado: {
    label: "Programado",
    Icon: CalendarClock,
    tone: "var(--status-programado)",
  },
  completado: {
    label: "Completado",
    Icon: CheckCircle2,
    tone: "var(--status-completado)",
  },
};

/** Orden de columnas en el Kanban. */
export const KANBAN_COLUMNS: Status[] = [
  "urgente",
  "en-curso",
  "pendiente",
  "programado",
  "completado",
  "standby",
];
