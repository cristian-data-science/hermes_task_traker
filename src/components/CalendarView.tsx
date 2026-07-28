import { useMemo, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  CalendarX2,
  CircleDot,
} from "lucide-react";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import type { Doc } from "~/convex/_generated/dataModel";
import { STATUS_META } from "../lib/constants";
import { parseTaskDates } from "../lib/dates";
import { cn } from "../lib/utils";

interface CalendarViewProps {
  tasks: Doc<"tasks">[];
  onEditTask: (task: Doc<"tasks">) => void;
}

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/**
 * Vista Calendario: mensual, con las tareas ubicadas según las fechas
 * que se puedan reconocer en dueDate / scheduledDates / standbyUntil.
 */
export function CalendarView({ tasks, onEditTask }: CalendarViewProps) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const today = new Date();

  // Indexar tareas por día (yyyy-MM-dd) + las que no tienen fecha reconocible
  const { byDay, undated } = useMemo(() => {
    const map = new Map<string, Doc<"tasks">[]>();
    const undated: Doc<"tasks">[] = [];
    for (const t of tasks) {
      const dates = parseTaskDates(t.dueDate, t.scheduledDates, t.standbyUntil);
      if (dates.length === 0) {
        if (t.status !== "completado") undated.push(t);
        continue;
      }
      for (const d of dates) {
        const key = format(d, "yyyy-MM-dd");
        const arr = map.get(key);
        if (arr) arr.push(t);
        else map.set(key, [t]);
      }
    }
    return { byDay: map, undated };
  }, [tasks]);

  // Días visibles del mes (semanas completas, lunes a domingo)
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    const out: Date[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
    return out;
  }, [month]);

  return (
    <div className="mx-auto max-w-[1400px]">
      {/* Header: navegación de mes */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold capitalize text-ink">
          {format(month, "MMMM yyyy", { locale: es })}
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonth((m) => addMonths(m, -1))}
            className="btn-ghost p-2"
            title="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setMonth(startOfMonth(new Date()))}
            className="btn-secondary px-3 py-1.5 text-xs"
          >
            Hoy
          </button>
          <button
            onClick={() => setMonth((m) => addMonths(m, 1))}
            className="btn-ghost p-2"
            title="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Grilla */}
      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="px-1 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-mute sm:text-xs"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const key = format(day, "yyyy-MM-dd");
            const dayTasks = byDay.get(key) ?? [];
            const inMonth = isSameMonth(day, month);
            const isToday = isSameDay(day, today);
            return (
              <div
                key={key}
                className={cn(
                  "min-h-[76px] border-b border-r border-line p-1 sm:min-h-[110px] sm:p-1.5",
                  (i + 1) % 7 === 0 && "border-r-0",
                  i >= days.length - 7 && "border-b-0",
                  !inMonth && "opacity-40",
                )}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={cn(
                      "grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold sm:h-6 sm:w-6 sm:text-xs",
                      isToday ? "bg-accent font-bold text-acfg" : "text-mute",
                    )}
                  >
                    {format(day, "d")}
                  </span>
                  {dayTasks.length > 3 && (
                    <span className="text-[9px] font-bold text-faint">
                      +{dayTasks.length - 3}
                    </span>
                  )}
                </div>
                <div className="space-y-0.5">
                  {dayTasks.slice(0, 3).map((t) => {
                    const meta = STATUS_META[t.status];
                    return (
                      <motion.button
                        key={`${key}-${t._id}`}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => onEditTask(t)}
                        title={`${meta.label} · ${t.title}`}
                        style={{ "--tone": meta.tone } as CSSProperties}
                        className={cn(
                          "block w-full truncate rounded-el px-1 py-0.5 text-left text-[9px] font-semibold leading-tight transition-colors hover:bg-panel2 sm:px-1.5 sm:text-[11px]",
                          t.status === "completado" && "line-through opacity-60",
                        )}
                      >
                        <span
                          className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                          style={{ background: "var(--tone)" }}
                        />
                        <span className="align-middle text-ink">{t.title}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tareas sin fecha reconocible */}
      {undated.length > 0 && (
        <div className="card mt-3 p-3 sm:p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-mute">
            <CalendarX2 className="h-3.5 w-3.5" />
            Sin fecha ({undated.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {undated.map((t) => {
              const meta = STATUS_META[t.status];
              return (
                <button
                  key={t._id}
                  onClick={() => onEditTask(t)}
                  style={{ "--tone": meta.tone } as CSSProperties}
                  className="tone-chip max-w-full px-2 py-1 text-xs"
                  title={meta.label}
                >
                  <CircleDot className="h-3 w-3 shrink-0" />
                  <span className="truncate">{t.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
