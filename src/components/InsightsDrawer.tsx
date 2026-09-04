import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "convex/react";
import { BarChart3, X } from "lucide-react";
import {
  addDays,
  differenceInCalendarDays,
  format,
  isSameDay,
  startOfDay,
} from "date-fns";
import { es } from "date-fns/locale";
import type { Doc } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import { useAuth } from "../hooks/useAuth";
import { cn } from "../lib/utils";

/** Fila reducida que devuelve imprevistos.statsRange. */
type ImprevistoStat = {
  _id: string;
  title: string;
  day: number;
  open: boolean;
  resolvedAt: number | null;
  promotedAt: number | null;
  promotedTaskId: string | null;
};

/** Agregado por día para la grilla del visor. */
type DayBucket = {
  day: number;
  surgidos: number;
  mismoDia: number;
  resueltosTarde: number;
  abiertos: number;
  promovidos: number;
  planeadas: number;
  planeadasHechas: number;
};

interface InsightsDrawerProps {
  open: boolean;
  onClose: () => void;
  tasks: Doc<"tasks">[];
}

/**
 * Visor de insights de imprevistos — el "para qué" de toda la feature:
 * cuánto trabajo no trackeado surge por día, cuánto se resuelve en el día y
 * cuánto se come el lugar de lo planificado (plan-vs-real).
 *
 * Toda la agregación es client-side con date-fns en hora local: el backend
 * devuelve filas crudas de imprevistos + dayItems por rango, y la unión con
 * `tasks` (para completedAt) sale de las tasks ya cargadas en la app.
 */
export function InsightsDrawer({ open, onClose, tasks }: InsightsDrawerProps) {
  const { token } = useAuth();
  const [rangeDays, setRangeDays] = useState<7 | 30>(7);

  const today = startOfDay(new Date()).getTime();
  const from = startOfDay(addDays(new Date(), -(rangeDays - 1))).getTime();
  const to = startOfDay(addDays(new Date(), 1)).getTime();

  const imprevistos =
    (useQuery(
      api.imprevistos.statsRange,
      token ? { sessionToken: token, from, to } : "skip",
    ) ?? []) as ImprevistoStat[];
  const dayItems =
    useQuery(api.hoy.listRange, token ? { sessionToken: token, from, to } : "skip") ?? [];

  const taskById = useMemo(() => {
    const m = new Map<string, Doc<"tasks">>();
    for (const t of tasks) m.set(t._id, t);
    return m;
  }, [tasks]);

  /** Buckets por día, del más viejo al más nuevo (se muestran al revés). */
  const buckets = useMemo<DayBucket[]>(() => {
    const byKey = new Map<number, DayBucket>();
    const bucketOf = (day: number): DayBucket => {
      let b = byKey.get(day);
      if (!b) {
        b = {
          day,
          surgidos: 0,
          mismoDia: 0,
          resueltosTarde: 0,
          abiertos: 0,
          promovidos: 0,
          planeadas: 0,
          planeadasHechas: 0,
        };
        byKey.set(day, b);
      }
      return b;
    };
    for (const imp of imprevistos) {
      const b = bucketOf(imp.day);
      b.surgidos++;

      // Un promovido cuya tarea ya se completó ES trabajo terminado: cuenta
      // como resuelto (mismo día o tardío según CUÁNDO se completó la tarea,
      // no cuándo se promovió). Promovido con la tarea aún viva sigue siendo
      // "promovido": el trabajo no terminó, cambió de forma.
      const promotedTask = imp.promotedTaskId
        ? taskById.get(imp.promotedTaskId)
        : undefined;
      const doneAt =
        imp.promotedAt !== null && promotedTask?.status === "completado"
          ? (promotedTask.completedAt ?? null)
          : imp.resolvedAt;

      if (imp.promotedAt !== null && doneAt === null) {
        b.promovidos++;
        continue;
      }
      if (doneAt !== null) {
        if (isSameDay(new Date(doneAt), new Date(imp.day))) b.mismoDia++;
        else b.resueltosTarde++;
      } else {
        b.abiertos++;
      }
    }
    // Plan-vs-real: hecha = la tarea está completada (no importa la fecha —
    // "la planeé y la terminé" es la pregunta que responde). Las tareas
    // eliminadas (o convertidas en imprevisto) salen del denominador: una
    // planeada que ya no existe no es una planeada "no hecha".
    for (const item of dayItems) {
      const task = taskById.get(item.taskId);
      if (!task || task.deletedAt !== undefined) continue;
      const b = bucketOf(item.day);
      b.planeadas++;
      if (task.status === "completado") b.planeadasHechas++;
    }
    return [...byKey.values()].sort((a, b) => a.day - b.day);
  }, [imprevistos, dayItems, taskById]);

  const totals = useMemo(() => {
    const surgidos = imprevistos.length;
    const resueltosMismoDia = buckets.reduce((s, b) => s + b.mismoDia, 0);
    // "Resueltos" para la demora: resuelto directo O promovido completado
    // (el trabajo terminó, que es lo que la demora mide).
    const donePairs = imprevistos
      .map((i) => {
        const promotedTask = i.promotedTaskId ? taskById.get(i.promotedTaskId) : undefined;
        const doneAt =
          i.promotedAt !== null && promotedTask?.status === "completado"
            ? (promotedTask.completedAt ?? null)
            : i.resolvedAt;
        return { day: i.day, doneAt };
      })
      .filter((p): p is { day: number; doneAt: number } => p.doneAt !== null);
    const demoras = donePairs
      .map((p) => differenceInCalendarDays(new Date(p.doneAt), new Date(p.day)))
      .filter((d) => d > 0);
    return {
      surgidos,
      mismoDia: resueltosMismoDia,
      mismoDiaPct: surgidos > 0 ? Math.round((resueltosMismoDia / surgidos) * 100) : null,
      abiertos: buckets.reduce((s, b) => s + b.abiertos, 0),
      promovidos: buckets.reduce((s, b) => s + b.promovidos, 0),
      promedioDia: surgidos / rangeDays,
      demoraPromedio: demoras.length > 0 ? demoras.reduce((s, d) => s + d, 0) / demoras.length : null,
      planeadas: buckets.reduce((s, b) => s + b.planeadas, 0),
      planeadasHechas: buckets.reduce((s, b) => s + b.planeadasHechas, 0),
    };
  }, [imprevistos, buckets, rangeDays, taskById]);

  /** Abiertos más viejos primero (los que más recurso se comen). */
  const viejosAbiertos = useMemo(
    () =>
      imprevistos
        .filter((i) => i.open)
        .sort((a, b) => a.day - b.day)
        .slice(0, 6),
    [imprevistos],
  );

  const maxSurgidos = Math.max(1, ...buckets.map((b) => b.surgidos));

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm"
          />
          <motion.aside
            key="drawer"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 60 }}
            transition={{ type: "spring", stiffness: 340, damping: 30 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-panel shadow-el-lg"
          >
            {/* ===== Header ===== */}
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <BarChart3 className="h-4 w-4 text-accent" />
              <h2 className="flex-1 text-sm font-semibold text-ink">
                Insights de imprevistos
              </h2>
              <div className="flex rounded-el border-el border-line bg-panel2 p-0.5">
                {([7, 30] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => setRangeDays(n)}
                    className={cn(
                      "rounded-el px-2 py-0.5 text-xs font-medium transition-colors",
                      rangeDays === n ? "bg-panel text-ink shadow-el" : "text-faint hover:text-ink",
                    )}
                  >
                    {n}d
                  </button>
                ))}
              </div>
              <button
                onClick={onClose}
                title="Cerrar"
                className="rounded-el p-1 text-faint transition-colors hover:bg-panel2 hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
              {/* ===== Totales ===== */}
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Imprevistos/día (prom.)" value={totals.promedioDia.toFixed(1)} />
                <Stat
                  label="Resueltos el mismo día"
                  value={totals.mismoDiaPct === null ? "—" : `${totals.mismoDiaPct}%`}
                />
                <Stat
                  label="Demora promedio de resolución"
                  value={totals.demoraPromedio === null ? "—" : `${totals.demoraPromedio.toFixed(1)} d`}
                />
                <Stat
                  label="Plan vs real (rango)"
                  value={`${totals.planeadasHechas}/${totals.planeadas}`}
                  hint="planeadas que quedaron completadas"
                />
              </div>

              {/* ===== Por día ===== */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mute">
                  Por día (últimos {rangeDays})
                </h3>
                {buckets.length === 0 && (
                  <p className="text-xs text-faint">
                    Todavía no hay imprevistos ni planeadas en este rango.
                  </p>
                )}
                <ul className="flex flex-col gap-1.5">
                  {[...buckets].reverse().map((b) => (
                    <li
                      key={b.day}
                      className="flex items-center gap-3 rounded-el border-el border-line bg-panel2 px-3 py-2"
                    >
                      <span className="w-24 shrink-0 text-xs capitalize text-mute">
                        {format(new Date(b.day), "EEE d MMM", { locale: es })}
                      </span>
                      {/* Barra de imprevistos: largo relativo al peor día */}
                      <span className="flex h-4 flex-1 items-center gap-1">
                        <span
                          className="h-2 rounded-full bg-[#d97706]"
                          style={{ width: `${(b.surgidos / maxSurgidos) * 100}%` }}
                          title={`${b.surgidos} imprevistos`}
                        />
                      </span>
                      <span className="shrink-0 text-xs text-mute" title="imprevistos surgidos">
                        <b className="text-ink">{b.surgidos}</b> imp
                      </span>
                      <span className="shrink-0 text-xs text-mute" title="resueltos el mismo día">
                        {b.mismoDia} al día
                      </span>
                      {b.abiertos > 0 && (
                        <span
                          className="shrink-0 text-xs font-medium text-[#d97706]"
                          title="quedaron abiertos"
                        >
                          {b.abiertos} abiertos
                        </span>
                      )}
                      {b.promovidos > 0 && (
                        <span className="shrink-0 text-xs text-accent" title="promovidos a tarea">
                          {b.promovidos} prom
                        </span>
                      )}
                      {b.planeadas > 0 && (
                        <span
                          className={cn(
                            "shrink-0 text-xs",
                            b.planeadasHechas < b.planeadas ? "text-faint" : "text-[var(--status-completado)]",
                          )}
                          title="planeadas completadas ese día"
                        >
                          {b.planeadasHechas}/{b.planeadas} plan
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              {/* ===== Abiertos más viejos ===== */}
              {viejosAbiertos.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mute">
                    Abiertos más viejos
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {viejosAbiertos.map((i) => (
                      <li key={i._id} className="flex items-center gap-2 text-sm">
                        <span className="shrink-0 rounded-full border-el border-line bg-panel2 px-1.5 text-[10px] font-medium text-[#d97706]">
                          día {differenceInCalendarDays(new Date(today), new Date(i.day)) + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-ink">{i.title}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/** Tarjeta de estadístico (lenguaje de ChipsRow del catch-up). */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-el border-el border-line bg-panel2 px-3 py-2.5">
      <p className="text-lg font-semibold leading-tight text-ink">{value}</p>
      <p className="mt-0.5 text-[11px] leading-tight text-mute">{label}</p>
      {hint && <p className="text-[10px] leading-tight text-faint">{hint}</p>}
    </div>
  );
}
