/**
 * Configuración y matemática de fechas del Catch-up semanal.
 *
 * Este módulo es PURO y compartido entre backend y frontend: no importa nada
 * de Convex ni de React. La razón es una decisión de diseño importante sobre
 * zonas horarias, explicada abajo.
 *
 * ===== POR QUÉ EL CLIENTE CALCULA LA VENTANA =====
 * El backend de Convex corre en UTC. Si el servidor calculara "el martes
 * pasado a las 00:00", en Chile (UTC-4/-3) esa frontera caería a las 20:00 o
 * 21:00 del lunes: las tareas completadas el lunes por la noche se colarían
 * en la semana equivocada, y las del martes temprano se perderían.
 *
 * Por eso el CLIENTE calcula `from`/`to` en hora local con estas funciones y
 * se los pasa al backend, que solo filtra por rango de timestamps. El backend
 * nunca interpreta qué día es: solo compara números. Así el corte cae siempre
 * a la medianoche real de Cristian, viva donde viva.
 */

/** Clave en la tabla `settings` donde vive el día ancla del catch-up. */
export const SETTINGS_KEY_CATCHUP_DAY = "catchup.anchorDay";

/**
 * Día de la semana en que ocurre el catch-up, en formato de `Date.getDay()`
 * (0 = domingo … 6 = sábado). Por defecto martes.
 */
export const DEFAULT_ANCHOR_DAY = 2;

/** Nombres de los días, para el selector de configuración. */
export const DAY_LABELS = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const;

/**
 * Áreas que entran al catch-up.
 *
 * Hoy es solo Patagonia: el catch-up es con la jefatura, y Datacef/Personal
 * no son parte de esa conversación. Está como constante y no hardcodeado en
 * cada query para que sumar un área sea cambiar una línea.
 */
export const CATCHUP_AREAS: readonly string[] = ["patagonia"];

/** Milisegundos en un día. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Normaliza un día ancla que venga de settings (tolera basura). */
export function parseAnchorDay(raw: string | undefined | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : DEFAULT_ANCHOR_DAY;
}

/**
 * Devuelve el inicio (00:00 hora local) del día ancla más reciente respecto a
 * `ref`. Si hoy ES el día ancla, devuelve hoy a las 00:00 — la semana nueva
 * arranca el mismo día del catch-up, que es cuando la conversación ocurre.
 */
export function startOfCurrentWeek(anchorDay: number, ref: Date = new Date()): number {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  // Cuántos días hay que retroceder para caer en el día ancla.
  const back = (d.getDay() - anchorDay + 7) % 7;
  d.setDate(d.getDate() - back);
  return d.getTime();
}

/**
 * Ventana de una semana de catch-up a partir de su inicio.
 * `to` es exclusivo: [from, to).
 */
export function weekWindow(weekStart: number): { from: number; to: number } {
  const start = new Date(weekStart);
  const end = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + 7,
  );
  return { from: weekStart, to: end.getTime() };
}

/** Desplaza una semana N posiciones (negativo = hacia atrás). */
export function shiftWeek(weekStart: number, delta: number): number {
  const d = new Date(weekStart);
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + delta * 7,
  ).getTime();
}

/** Cantidad de días completos entre dos timestamps (redondeado hacia abajo). */
export function daysBetween(from: number, to: number): number {
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

/** Etiqueta corta de un rango: "mar 04 ago → lun 10 ago". */
export function formatWindowLabel(from: number, to: number): string {
  const fmt = (ms: number) =>
    new Date(ms).toLocaleDateString("es-CL", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
  // `to` es exclusivo: se muestra el último día incluido.
  return `${fmt(from)} → ${fmt(to - DAY_MS)}`;
}

/** Estados que cuentan como "trabajo en marcha" en el resumen. */
export const ACTIVE_STATUSES = ["en-curso", "urgente"] as const;

/** Estados que cuentan como "detenido / esperando algo". */
export const BLOCKED_STATUSES = ["standby", "programado"] as const;
