/**
 * Períodos de ausencia (área Patagonia) — config en la tabla `settings`.
 *
 * Concepto de ANOTACIÓN, no de cálculo: los insights siguen mostrando los
 * datos tal cual; cuando el rango mostrado solapa un período, la UI etiqueta
 * explícitamente "hubo un período de ausencia de X a Y" para que los números
 * bajos tengan contexto. Nada se excluye ni se recalcula (misma filosofía
 * que la "honestidad de datos" de InsightsView).
 *
 * Formato guardado en settings (`ausencias.periodos`): JSON array de
 * { desde, hasta, etiqueta? } con fechas "YYYY-MM-DD" INCLUSIVAS en día
 * local. `hasta` es el ÚLTIMO día ausente: si vuelves el lunes 21, el
 * período termina el domingo 20.
 */

export const SETTINGS_KEY_AUSENCIAS = "ausencias.periodos";

export interface AusenciaPeriodo {
  /** Primer día ausente (YYYY-MM-DD, inclusivo). */
  desde: string;
  /** Último día ausente (YYYY-MM-DD, inclusivo; el regreso ya no cuenta). */
  hasta: string;
  /** Etiqueta legible opcional ("Vacaciones", "Licencia médica"...). */
  etiqueta?: string;
}

/**
 * Semilla por defecto: mientras la clave no exista en settings, estos
 * períodos aparecen seteados (vacaciones de septiembre 2026). Al guardar la
 * lista desde el panel de configuración se persiste el valor explícito y la
 * semilla deja de aplicar.
 */
export const AUSENCIAS_INICIALES: AusenciaPeriodo[] = [
  { desde: "2026-09-14", hasta: "2026-09-20", etiqueta: "Vacaciones" },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PERIODOS = 50;
const ETIQUETA_MAX = 100;

/** ¿Es una fecha ISO de calendario válida (YYYY-MM-DD)? */
export function esFechaAusencia(s: string): boolean {
  return DATE_RE.test(s);
}

/** Normaliza una lista cruda a períodos válidos (recorta y ordena). */
function limpiarLista(lista: unknown[]): AusenciaPeriodo[] {
  const out: AusenciaPeriodo[] = [];
  for (const item of lista) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const desde = typeof o.desde === "string" ? o.desde.trim() : "";
    const hasta = typeof o.hasta === "string" ? o.hasta.trim() : "";
    const etiqueta = typeof o.etiqueta === "string" ? o.etiqueta.trim() : "";
    if (!DATE_RE.test(desde) || !DATE_RE.test(hasta) || desde > hasta) continue;
    out.push({
      desde,
      hasta,
      ...(etiqueta ? { etiqueta: etiqueta.slice(0, ETIQUETA_MAX) } : {}),
    });
    if (out.length >= MAX_PERIODOS) break;
  }
  return out.sort((a, b) => a.desde.localeCompare(b.desde));
}

/**
 * Parsea la lista guardada. Clave ausente → la semilla inicial; JSON roto o
 * filas inválidas → se descartan (nunca lanza).
 */
export function parseAusencias(raw: string | undefined): AusenciaPeriodo[] {
  if (!raw) return AUSENCIAS_INICIALES;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return AUSENCIAS_INICIALES;
    return limpiarLista(parsed);
  } catch {
    return AUSENCIAS_INICIALES;
  }
}
