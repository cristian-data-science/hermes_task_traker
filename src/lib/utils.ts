import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combina clases de Tailwind resolviendo conflictos. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formatea un timestamp (ms) a fecha legible en español. */
export function formatDate(ms?: number | null): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleDateString("es-CL", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

/** Formatea un timestamp (ms) relativo (ej. "hace 3 días"). */
export function formatRelative(ms?: number | null): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  if (days < 30) return `hace ${Math.floor(days / 7)} sem`;
  return formatDate(ms);
}

/** CSS variable con el color tonal de un estado (depende del tema activo). */
export function statusTone(status: string): string {
  return `var(--status-${status}, var(--muted))`;
}
