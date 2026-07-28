/**
 * Parser tolerante de fechas en texto libre (español).
 * Los campos dueDate/scheduledDates son strings escritos a mano, ej:
 *  "2026-07-29" · "08-jul-2026" · "29 y 30 de julio 2026" · "29 de julio"
 */

const MONTHS: Record<string, number> = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  setiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};

const MONTH_ABBR: Record<string, number> = {
  ene: 0,
  feb: 1,
  mar: 2,
  abr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  ago: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dic: 11,
};

function pushValid(out: Date[], y: number, m: number, d: number) {
  if (m < 0 || m > 11 || d < 1 || d > 31) return;
  const date = new Date(y, m, d);
  if (!isNaN(date.getTime())) out.push(date);
}

/** Extrae todas las fechas reconocibles de uno o más strings. */
export function parseTaskDates(
  ...inputs: (string | undefined | null)[]
): Date[] {
  const out: Date[] = [];
  const now = new Date();

  for (const raw of inputs) {
    if (!raw) continue;
    const s = raw.toLowerCase().trim();

    // 1) ISO: yyyy-mm-dd (también yyyy/mm/dd)
    for (const m of s.matchAll(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/g)) {
      pushValid(out, +m[1], +m[2] - 1, +m[3]);
    }

    // 2) dd-mmm-yyyy: 08-jul-2026 (también dd/mmm/yyyy)
    for (const m of s.matchAll(/(\d{1,2})[-/]([a-záéíóú]{3,5})[-/](\d{4})/g)) {
      const mo = MONTH_ABBR[m[2].slice(0, 4)] ?? MONTH_ABBR[m[2].slice(0, 3)];
      if (mo !== undefined) pushValid(out, +m[3], mo, +m[1]);
    }

    // 3) dd/mm/yyyy o dd-mm-yyyy
    for (const m of s.matchAll(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/g)) {
      pushValid(out, +m[3], +m[2] - 1, +m[1]);
    }

    // 4) "29 de julio [de 2026]" con lista opcional "28, 29 y 30 de julio"
    const deMatch = s.match(
      /((?:\d{1,2}\s*[,y]\s*)*\d{1,2})\s+de\s+([a-záéíóú]+)(?:\s+(?:de\s+)?(\d{4}))?/,
    );
    if (deMatch) {
      const mo = MONTHS[deMatch[2]];
      if (mo !== undefined) {
        const year = deMatch[3] ? +deMatch[3] : now.getFullYear();
        const days = deMatch[1]
          .split(/[,y]/)
          .map((d) => parseInt(d.trim(), 10))
          .filter((d) => !isNaN(d));
        for (const d of days) pushValid(out, year, mo, d);
      }
    }
  }

  // Dedupe por día
  const seen = new Set<string>();
  return out.filter((d) => {
    const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
