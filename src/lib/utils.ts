import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { ANDROID_TWA } from "./platform";

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

/**
 * ¿Es una súper urgente VIVA? La capa de visualización (siempre visible +
 * anclada primera + borde RGB) solo aplica mientras la tarea está activa:
 * al completarla descansa como cualquier otra.
 *
 * Es EXCLUSIVA de la versión web: dentro del APK Android (TWA) la tarea se
 * comporta como una más — sin bypass de filtros, sin anclado y sin borde.
 * El dato `superUrgent` igualmente viaja en el modelo, así que una tarea
 * marcada en la web conserva su marca al editarse desde el APK.
 */
export const SUPER_URGENT_ENABLED = !ANDROID_TWA;

export function isSuperUrgent(t: {
  superUrgent?: boolean;
  status: string;
}): boolean {
  return SUPER_URGENT_ENABLED && t.superUrgent === true && t.status !== "completado";
}

/**
 * La capa agente (delegación a ZCode: selector de tipo/carpeta/autonomía,
 * chips de estado, panel de corridas y vista Agente) es EXCLUSIVA de la web,
 * igual que la súper urgente. El APK no se toca por ahora: los campos del
 * modelo viajan igual, así que una tarea delegada desde la web se edita sin
 * perder su delegación desde donde sea.
 */
export const AGENT_UI_ENABLED = !ANDROID_TWA;
