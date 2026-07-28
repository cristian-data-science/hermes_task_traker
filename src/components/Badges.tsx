import type { CSSProperties } from "react";
import { STATUS_META, AREA_META, type Status, type Area } from "../lib/constants";
import { cn } from "../lib/utils";

/** Badge de estado: icono Lucide + label, tonal según tema. */
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
      style={{ "--tone": meta.tone } as CSSProperties}
      className={cn(
        "tone-chip",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-1.5 py-0.5 text-[10px]",
      )}
    >
      <meta.Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-3 w-3"} />
      <span>{meta.label}</span>
    </span>
  );
}

/** Badge de área: icono Lucide + label, tonal según tema. */
export function AreaBadge({ area }: { area: Area }) {
  const meta = AREA_META[area];
  return (
    <span
      style={{ "--tone": meta.tone } as CSSProperties}
      className="tone-chip px-2 py-0.5 text-[11px]"
    >
      <meta.Icon className="h-3 w-3" />
      <span>{meta.label}</span>
    </span>
  );
}

/** Punto de color tonal (headers de columna del Kanban). */
export function StatusDot({ status }: { status: Status }) {
  return (
    <span
      style={{ "--tone": STATUS_META[status].tone } as CSSProperties}
      className="tone-dot"
    />
  );
}
