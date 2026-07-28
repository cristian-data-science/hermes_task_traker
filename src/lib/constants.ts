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
  Leaf,
  CirclePause,
  CalendarClock,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";

export const AREAS = ["patagonia", "datacef", "personal"] as const;
export type Area = (typeof AREAS)[number];

/** Ejecutores disponibles: Cris (tú) o Claw (agente Hermes). */
export const EXECUTORS = ["cris", "claw"] as const;
export type Executor = (typeof EXECUTORS)[number];

export const EXECUTOR_META: Record<
  Executor,
  { label: string; emoji: string; color: string }
> = {
  cris: {
    label: "Cris",
    emoji: "🧑",
    color: "text-indigo-600 dark:text-indigo-400",
  },
  claw: {
    label: "Claw",
    emoji: "🤖",
    color: "text-amber-600 dark:text-amber-400",
  },
};

export const STATUSES = [
  "urgente",
  "pendiente",
  "baja",
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
  { label: string; Icon: LucideIcon; tone: string }
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
  baja: {
    label: "Baja prioridad",
    Icon: Leaf,
    tone: "var(--status-baja)",
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
  "pendiente",
  "standby",
  "programado",
  "baja",
  "completado",
];
