import { endOfDay, parseISO } from "date-fns";

/**
 * Períodos de ausencia (área Patagonia) — espejo del tipo de Convex.
 * Concepto de anotación: los insights siguen calculando todo igual; cuando
 * el rango mostrado solapa un período, se etiqueta explícitamente para que
 * un número bajo tenga justificación visible.
 */
export interface AusenciaPeriodo {
  /** Primer día ausente (YYYY-MM-DD, inclusivo). */
  desde: string;
  /** Último día ausente (YYYY-MM-DD, inclusivo; el regreso ya no cuenta). */
  hasta: string;
  /** Etiqueta legible opcional ("Vacaciones", "Licencia médica"...). */
  etiqueta?: string;
}

/**
 * Períodos que solapan el rango [from, to] (timestamps ms, bordes
 * inclusivos). Fechas inválidas se descartan silenciosamente (NaN nunca
 * compara true).
 */
export function ausenciasSolapadas(
  periodos: AusenciaPeriodo[],
  from: number,
  to: number,
): AusenciaPeriodo[] {
  return periodos.filter((p) => {
    const inicio = parseISO(p.desde).getTime();
    const fin = endOfDay(parseISO(p.hasta)).getTime();
    return inicio <= to && fin >= from;
  });
}

/** Frase corta "14 sep – 20 sep 2026" para etiquetar el período en la UI. */
export function rangoAusenciaLegible(p: AusenciaPeriodo): string {
  const d = parseISO(p.desde);
  const h = parseISO(p.hasta);
  if (isNaN(d.getTime()) || isNaN(h.getTime())) return `${p.desde} – ${p.hasta}`;
  const mesCorto = (date: Date) =>
    date.toLocaleDateString("es", { day: "numeric", month: "short" });
  const anio = h.getFullYear();
  return `${mesCorto(d)} – ${mesCorto(h)} ${anio}`;
}
