import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "../lib/utils";

// Cabeceras compactas para el calendario (miércoles = "X").
const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];

const POPOVER_W = 272; // 17rem
const POPOVER_H_APPROX = 330;
const GAP = 6;

interface DatePickerProps {
  /** Valor actual (string libre, como los demás campos de fecha). */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible label / title del botón de calendario. */
  label?: string;
}

/** Intenta interpretar el valor como fecha (YYYY-MM-DD). */
function parseValueToDate(value: string): Date | null {
  const v = value.trim();
  if (!v) return null;
  // Sólo se “ancla” el calendario si hay una fecha ISO válida; el texto
  // libre (“mañana”, “29 de julio”) se conserva tal cual en el input.
  const iso = parseISO(v);
  return isValid(iso) ? iso : null;
}

/**
 * Campo de fecha con calendario desplegable.
 *
 * Mantiene el input de texto libre (compatible con `parseTaskDates`) y suma un
 * botón de calendario que vuelca la fecha elegida como `yyyy-MM-dd`. El
 * calendario se renderiza vía portal a `document.body` para no verse recortado
 * por el `overflow`/`transform` del modal contenedor.
 */
export function DatePicker({
  value,
  onChange,
  placeholder,
  label = "Abrir calendario",
}: DatePickerProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<Date>(
    () => startOfMonth(new Date()),
  );
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );

  const selected = parseValueToDate(value);

  /** Posiciona el popover (fixed) bajo —o sobre— el trigger según espacio. */
  function computeCoords() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const bottomSpace = window.innerHeight - r.bottom;
    const top =
      bottomSpace >= POPOVER_H_APPROX + GAP
        ? r.bottom + GAP
        : Math.max(GAP, r.top - POPOVER_H_APPROX - GAP);
    let left = r.left;
    if (left + POPOVER_W > window.innerWidth - GAP)
      left = window.innerWidth - POPOVER_W - GAP;
    if (left < GAP) left = GAP;
    setCoords({ top, left });
  }

  // Al abrir: anclar el mes a la fecha actual y posicionar + listeners.
  useLayoutEffect(() => {
    if (!open) return;
    const d = parseValueToDate(value);
    setViewMonth(d ? startOfMonth(d) : startOfMonth(new Date()));
    computeCoords();

    const reposition = () => computeCoords();
    // capture=true atrapa el scroll de contenedores internos (ej. el body del modal).
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
    // value se lee al abrir intencionalmente; no depender de él.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Cerrar al clic fuera y con Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Días visibles (semanas completas, lun→dom).
  const days: Date[] = [];
  const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);

  const today = new Date();

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input pr-10"
        inputMode="numeric"
      />
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        className={cn(
          "absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-el transition-colors",
          open
            ? "bg-panel2 text-accent"
            : "text-mute hover:bg-panel2 hover:text-accent",
        )}
      >
        <Calendar className="h-4 w-4" />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && coords && (
            <motion.div
              ref={popoverRef}
              role="dialog"
              aria-modal="true"
              aria-label="Seleccionar fecha"
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.14 }}
              style={{ top: coords.top, left: coords.left, width: POPOVER_W }}
              className="fixed z-[70] rounded-el border-el border-line bg-panel p-2 shadow-el-lg"
            >
              {/* Cabecera: navegación de mes */}
              <div className="flex items-center justify-between px-1 pb-2">
                <button
                  type="button"
                  onClick={() => setViewMonth((m) => addMonths(m, -1))}
                  className="btn-ghost p-1"
                  aria-label="Mes anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs font-bold capitalize text-ink">
                  {format(viewMonth, "MMMM yyyy", { locale: es })}
                </span>
                <button
                  type="button"
                  onClick={() => setViewMonth((m) => addMonths(m, 1))}
                  className="btn-ghost p-1"
                  aria-label="Mes siguiente"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* Cabecera de días */}
              <div className="grid grid-cols-7 px-1 pb-1">
                {WEEKDAYS.map((d) => (
                  <div
                    key={d}
                    className="text-center text-[10px] font-bold uppercase text-faint"
                  >
                    {d}
                  </div>
                ))}
              </div>

              {/* Grilla de días */}
              <div className="grid grid-cols-7 gap-0.5">
                {days.map((day) => {
                  const inMonth = isSameMonth(day, viewMonth);
                  const isToday = isSameDay(day, today);
                  const isSelected = !!selected && isSameDay(day, selected);
                  return (
                    <button
                      key={format(day, "yyyy-MM-dd")}
                      type="button"
                      onClick={() => {
                        onChange(format(day, "yyyy-MM-dd"));
                        setOpen(false);
                      }}
                      className={cn(
                        "grid h-8 w-8 place-items-center rounded-el text-xs transition-colors",
                        !inMonth && "opacity-35",
                        !isSelected && !isToday && "text-ink hover:bg-panel2",
                        isSelected && "bg-accent font-bold text-acfg",
                        !isSelected &&
                          isToday &&
                          "font-semibold text-accent ring-1 ring-accent",
                      )}
                    >
                      {format(day, "d")}
                    </button>
                  );
                })}
              </div>

              {/* Accesos rápidos */}
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-line px-1 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    onChange(format(new Date(), "yyyy-MM-dd"));
                    setOpen(false);
                  }}
                  className="btn-secondary px-2.5 py-1 text-xs"
                >
                  Hoy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  disabled={!value}
                  className="btn-ghost px-2.5 py-1 text-xs text-mute disabled:opacity-40"
                >
                  Limpiar
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
