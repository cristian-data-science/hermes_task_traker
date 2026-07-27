/**
 * Constantes compartidas: áreas, estados, configuración de badges/colores.
 * Refleja la leyenda del archivo tareas-pendientes.md.
 */

export const AREAS = ["patagonia", "datacef", "personal"] as const;
export type Area = (typeof AREAS)[number];

export const STATUSES = [
  "urgente",
  "pendiente",
  "baja",
  "standby",
  "programado",
  "completado",
] as const;
export type Status = (typeof STATUSES)[number];

/** Metadata visual de cada área. */
export const AREA_META: Record<
  Area,
  { label: string; icon: string; color: string; emoji: string }
> = {
  patagonia: {
    label: "Patagonia",
    icon: "briefcase",
    color: "text-sky-600 dark:text-sky-400",
    emoji: "💼",
  },
  datacef: {
    label: "Datacef",
    icon: "building-2",
    color: "text-violet-600 dark:text-violet-400",
    emoji: "🏢",
  },
  personal: {
    label: "Personal",
    icon: "home",
    color: "text-emerald-600 dark:text-emerald-400",
    emoji: "🏠",
  },
};

/** Metadata visual de cada estado (alineado con la leyenda del .md). */
export const STATUS_META: Record<
  Status,
  { label: string; emoji: string; color: string; bg: string; border: string; dot: string }
> = {
  urgente: {
    label: "Urgente",
    emoji: "🔴",
    color: "text-red-700 dark:text-red-300",
    bg: "bg-red-50 dark:bg-red-950/40",
    border: "border-red-200 dark:border-red-900",
    dot: "bg-red-500",
  },
  pendiente: {
    label: "Pendiente",
    emoji: "🟡",
    color: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-50 dark:bg-amber-950/40",
    border: "border-amber-200 dark:border-amber-900",
    dot: "bg-amber-500",
  },
  baja: {
    label: "Baja prioridad",
    emoji: "🟢",
    color: "text-green-700 dark:text-green-300",
    bg: "bg-green-50 dark:bg-green-950/40",
    border: "border-green-200 dark:border-green-900",
    dot: "bg-green-500",
  },
  standby: {
    label: "Standby",
    emoji: "⏸️",
    color: "text-slate-600 dark:text-slate-300",
    bg: "bg-slate-100 dark:bg-slate-800/60",
    border: "border-slate-200 dark:border-slate-700",
    dot: "bg-slate-500",
  },
  programado: {
    label: "Programado",
    emoji: "📅",
    color: "text-blue-700 dark:text-blue-300",
    bg: "bg-blue-50 dark:bg-blue-950/40",
    border: "border-blue-200 dark:border-blue-900",
    dot: "bg-blue-500",
  },
  completado: {
    label: "Completado",
    emoji: "✅",
    color: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    border: "border-emerald-200 dark:border-emerald-900",
    dot: "bg-emerald-500",
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
