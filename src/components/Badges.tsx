import { STATUS_META, AREA_META, type Status, type Area } from "../lib/constants";
import { cn } from "../lib/utils";

/** Badge de estado (emoji + label + color). */
export function StatusBadge({
  status,
  size = "sm",
}: {
  status: Status;
  size?: "sm" | "xs";
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium",
        meta.bg,
        meta.color,
        meta.border,
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-1.5 py-0.5 text-[10px]",
      )}
    >
      <span>{meta.emoji}</span>
      <span>{meta.label}</span>
    </span>
  );
}

/** Badge de área (emoji + label + color). */
export function AreaBadge({ area }: { area: Area }) {
  const meta = AREA_META[area];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium",
        meta.color,
        "bg-slate-100 dark:bg-slate-800",
      )}
    >
      <span>{meta.emoji}</span>
      <span>{meta.label}</span>
    </span>
  );
}

/** Punto de color (para headers de columna del Kanban). */
export function StatusDot({ status }: { status: Status }) {
  return (
    <span
      className={cn("inline-block h-2.5 w-2.5 rounded-full", STATUS_META[status].dot)}
    />
  );
}
