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
 * Inicio (00:00 hora local) de la ventana de catch-up que contiene a `ref`.
 *
 * ===== MARTES A MARTES, CON EL MARTES FINAL INCLUSIVO =====
 * La ventana siempre arranca el día ancla y termina el ancla siguiente
 * (inclusivo): 8 días calendario. "No importa que sean más de siete días":
 * lo completado el día de la reunión también es parte de esa semana, y el
 * rango se lee martes → martes sin excepciones.
 *
 * El día de la reunión, la ventana sigue siendo la que TERMINA hoy (para
 * preparar y presentar). Recién al día siguiente pasa a la semana nueva.
 *
 * Así, con ancla en martes:
 *   - lunes 17    → [martes 11 … martes 18]  ← la que vas a presentar mañana
 *   - martes 18   → [martes 11 … martes 18]  ← presentás hoy, hoy cuenta
 *   - miércoles 19 → [martes 18 … martes 25] ← la semana nueva
 *
 * Consecuencia aceptada a propósito: dos ventanas consecutivas comparten el
 * día ancla (el martes 18 entra en la semana que se presenta ese día y en la
 * siguiente). Es el solape explícito que pidió el diseño: claridad del rango
 * por encima de la exclusividad de la métrica.
 */
export function startOfCurrentWeek(anchorDay: number, ref: Date = new Date()): number {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  // Días desde el último ancla (0 si hoy ES el ancla). El día ancla pertenece
  // a la ventana que TERMINA en él, así que si hoy es ancla hay que irse 7
  // días atrás: la que presentás hoy es la que empezó el ancla anterior.
  const since = (d.getDay() - anchorDay + 7) % 7;
  d.setDate(d.getDate() - (since === 0 ? 7 : since));
  return startOfDay(d);
}

/**
 * Primer instante del día, a prueba de cambios de hora.
 *
 * ===== POR QUÉ NO ALCANZA CON new Date(y, m, d) =====
 * El día en que Chile adelanta el reloj, las 00:00 NO EXISTEN: el día empieza
 * a la 01:00. `new Date(2026, 8, 6)` devuelve entonces las 01:00, y si esa
 * hora se arrastra con `setDate()` a otra fecha —donde la medianoche sí
 * existe— la ventana queda corrida una hora.
 *
 * Eso no sería un detalle cosmético: `getWeek` busca el catch-up cerrado con
 * una igualdad EXACTA de `weekStart`. Una hora de desfase y una semana que sí
 * cerraste aparecería como abierta, con su snapshot inaccesible.
 *
 * Normalizando al final, el resultado es siempre el primer instante real del
 * día de destino (00:00, o 01:00 los días en que la medianoche no existe).
 */
function startOfDay(d: Date): number {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out.getTime();
}

/**
 * Ventana de una semana de catch-up a partir de su inicio.
 *
 * `to` es exclusivo y marca el día POSTERIOR al ancla final: [martes, miércoles+7)
 * = 8 días calendario, para que el martes de cierre quede incluido completo.
 * Ver el comentario de `startOfCurrentWeek` sobre el solape aceptado.
 */
export function weekWindow(weekStart: number): { from: number; to: number } {
  const start = new Date(weekStart);
  const end = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + 8,
  );
  // Ojo: `to - from` NO siempre son 192 horas. La semana del cambio de hora
  // mide una más o una menos, y está bien: la ventana la definen los días del
  // calendario local, no una cantidad fija de milisegundos.
  return { from: weekStart, to: startOfDay(end) };
}

/** Desplaza una semana N posiciones (negativo = hacia atrás). */
export function shiftWeek(weekStart: number, delta: number): number {
  const d = new Date(weekStart);
  return startOfDay(
    new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta * 7),
  );
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

/**
 * Estados que cuentan como "trabajo en marcha" en el resumen.
 *
 * Solo `en-curso`. Antes incluía `urgente`, y eso inflaba el número que más se
 * mira: una tarea urgente es una que hay que empezar, no una que se esté
 * haciendo. Mezclarlas hacía parecer que había el doble de trabajo en marcha
 * del que realmente había.
 */
export const ACTIVE_STATUSES = ["en-curso"] as const;

/**
 * "En cola": lo urgente, que espera que lo tomes ya.
 *
 * Va separado de `pendiente` a propósito. Meterlos juntos daba un número que
 * no se puede accionar: dos urgentes entre veinte pendientes desaparecen en
 * el promedio, y en el catch-up lo urgente es justo lo que hay que nombrar.
 */
export const QUEUED_STATUSES = ["urgente"] as const;

/** "Pendientes": el backlog vivo, lo que hay por delante sin urgencia. */
export const PENDING_STATUSES = ["pendiente"] as const;

/** Estados que cuentan como "detenido / esperando algo". */
export const BLOCKED_STATUSES = ["standby", "programado"] as const;
