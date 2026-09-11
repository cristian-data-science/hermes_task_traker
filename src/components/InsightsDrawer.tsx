import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "convex/react";
import { BarChart3, ChevronDown, Maximize2, Minimize2, X } from "lucide-react";
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
import { ausenciasSolapadas, rangoAusenciaLegible } from "../lib/ausencias";

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

/**
 * Sábados y domingos ruedan al lunes: el visor cuenta en días hábiles
 * (pedido de Cris — los fines de semana no se muestran ni se cuentan como
 * día propio). Es solo visual/estadística: el `day` guardado no se toca.
 */
function diaHabil(ts: number): number {
  const d = new Date(ts);
  const wd = d.getDay();
  if (wd === 6) return startOfDay(addDays(d, 2)).getTime(); // sábado → lunes
  if (wd === 0) return startOfDay(addDays(d, 1)).getTime(); // domingo → lunes
  return startOfDay(ts).getTime();
}

function esFinDeSemana(ts: number): boolean {
  const wd = new Date(ts).getDay();
  return wd === 0 || wd === 6;
}

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
  const [rangeDays, setRangeDays] = useState<7 | 14 | 30>(7);
  // Drawer agrandable (para leer imprevistos largos) + día desplegado.
  const [wide, setWide] = useState(false);
  const [expandedDay, setExpandedDay] = useState<number | null>(null);

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

  // Anotación de ausencia: si el rango del visor pisa un período seteado,
  // se muestra el aviso; los cálculos no cambian.
  const ausencias =
    useQuery(
      api.settings.listarAusencias,
      token ? { sessionToken: token } : "skip",
    ) ?? [];
  const ausenciasRango = useMemo(
    () => ausenciasSolapadas(ausencias, from, to),
    [ausencias, from, to],
  );

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
      const b = bucketOf(diaHabil(imp.day));
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
      const b = bucketOf(diaHabil(item.day));
      b.planeadas++;
      if (task.status === "completado") b.planeadasHechas++;
    }
    // TODOS los días HÁBILES del rango entran a la grilla (también los
    // ceros): calendario lunes a viernes, sin sábados ni domingos.
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = startOfDay(addDays(new Date(), -i)).getTime();
      if (!esFinDeSemana(d)) bucketOf(d);
    }
    return [...byKey.values()].sort((a, b) => a.day - b.day);
  }, [imprevistos, dayItems, taskById, rangeDays]);

  /** Los imprevistos de cada día (ruedan al lunes si cayeron en fin de
      semana), para desplegar la fila al clickearla. */
  const imprevistosByDay = useMemo(() => {
    const m = new Map<number, ImprevistoStat[]>();
    for (const imp of imprevistos) {
      const key = diaHabil(imp.day);
      const list = m.get(key) ?? [];
      list.push(imp);
      m.set(key, list);
    }
    return m;
  }, [imprevistos]);

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
            className={cn(
              "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-panel shadow-el-lg transition-[max-width]",
              wide ? "max-w-3xl" : "max-w-md",
            )}
          >
            {/* ===== Header ===== */}
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <BarChart3 className="h-4 w-4 text-accent" />
              <h2 className="flex-1 text-sm font-semibold text-ink">
                Insights de imprevistos
              </h2>
              <div className="flex rounded-el border-el border-line bg-panel2 p-0.5">
                {([7, 14, 30] as const).map((n) => (
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
                onClick={() => setWide((v) => !v)}
                title={wide ? "Volver al ancho normal" : "Agrandar para leer mejor"}
                className="rounded-el p-1 text-faint transition-colors hover:bg-panel2 hover:text-ink"
              >
                {wide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button
                onClick={onClose}
                title="Cerrar"
                className="rounded-el p-1 text-faint transition-colors hover:bg-panel2 hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
              {/* ===== Aviso de ausencia en el rango ===== */}
              {ausenciasRango.length > 0 && (
                <div className="space-y-1 rounded-el border-el border-line bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  {ausenciasRango.map((p) => (
                    <p key={p.desde}>
                      <span className="font-semibold">
                        🧳 Período de ausencia{p.etiqueta ? ` (${p.etiqueta})` : ""}:
                      </span>{" "}
                      {rangoAusenciaLegible(p)} — incluye días sin actividad.
                    </p>
                  ))}
                </div>
              )}

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

              {/* ===== Por día (clickeable: despliega los imprevistos del día) ===== */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mute">
                  Por día (últimos {rangeDays} · lunes a viernes)
                </h3>
                <p className="mb-2 text-[10px] text-faint">
                  Tocá un día para ver sus imprevistos. Lo que surge sábado o
                  domingo cuenta como lunes.
                </p>
                <ul className="flex flex-col gap-1.5">
                  {[...buckets].reverse().map((b) => {
                    const isOpen = expandedDay === b.day;
                    const delDia = imprevistosByDay.get(b.day) ?? [];
                    return (
                      <li key={b.day}>
                        <button
                          onClick={() => setExpandedDay(isOpen ? null : b.day)}
                          title={isOpen ? "Plegar el día" : "Ver los imprevistos del día"}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-el border-el px-3 py-2 text-left transition-colors",
                            isOpen
                              ? "border-accent/40 bg-panel2"
                              : "border-line bg-panel2 hover:border-accent/30",
                          )}
                        >
                          <ChevronDown
                            className={cn(
                              "h-3.5 w-3.5 shrink-0 text-faint transition-transform",
                              isOpen && "rotate-180",
                            )}
                          />
                          <span className="w-24 shrink-0 text-xs capitalize text-mute">
                            {format(new Date(b.day), "EEE d MMM", { locale: es })}
                          </span>
                          {/* Barra de imprevistos: largo relativo al peor día */}
                          <span className="flex h-4 min-w-0 flex-1 items-center">
                            <span
                              className={cn(
                                "h-2 rounded-full",
                                b.surgidos > 0 ? "bg-[#d97706]" : "bg-line",
                              )}
                              style={{ width: `${Math.max(4, (b.surgidos / maxSurgidos) * 100)}%` }}
                              title={`${b.surgidos} imprevistos`}
                            />
                          </span>
                          <span className="shrink-0 text-xs text-mute" title="imprevistos surgidos">
                            <b className={cn(b.surgidos > 0 ? "text-ink" : "text-faint")}>{b.surgidos}</b> imp
                          </span>
                          {b.mismoDia > 0 && (
                            <span className="shrink-0 text-xs text-mute" title="resueltos el mismo día">
                              {b.mismoDia} al día
                            </span>
                          )}
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
                        </button>
                        {isOpen && (
                          <div className="mt-1 rounded-el border-el border-line bg-panel px-3 py-2">
                            {delDia.length === 0 && (
                              <p className="py-1 text-xs text-faint">
                                Sin imprevistos ese día.
                                {b.planeadas > 0 &&
                                  ` (planeadas ${b.planeadasHechas}/${b.planeadas} completadas)`}
                              </p>
                            )}
                            <ul className="flex flex-col gap-1.5">
                              {delDia.map((imp) => {
                                const promotedTask = imp.promotedTaskId
                                  ? taskById.get(imp.promotedTaskId)
                                  : undefined;
                                const doneAt =
                                  imp.promotedAt !== null && promotedTask?.status === "completado"
                                    ? (promotedTask.completedAt ?? null)
                                    : imp.resolvedAt;
                                const estado = imp.promotedAt !== null
                                  ? doneAt !== null
                                    ? { label: "promovido ✓", cls: "text-[var(--status-completado)]" }
                                    : { label: "promovido (en curso)", cls: "text-accent" }
                                  : doneAt !== null
                                    ? isSameDay(new Date(doneAt), new Date(imp.day))
                                      ? { label: "resuelto al día", cls: "text-[var(--status-completado)]" }
                                      : { label: "resuelto tarde", cls: "text-faint" }
                                    : { label: "abierto", cls: "text-[#d97706]" };
                                return (
                                  <li key={imp._id} className="border-b border-line py-1.5 last:border-b-0">
                                    <p className={cn("break-words text-sm leading-snug text-ink", doneAt !== null || imp.open === false ? "" : "")}>
                                      {imp.title}
                                    </p>
                                    <p className="mt-0.5 flex items-center gap-2 text-[10px]">
                                      <span className={cn("font-semibold", estado.cls)}>{estado.label}</span>
                                      <span className="text-faint">
                                        {doneAt !== null
                                          ? `· resuelto ${format(new Date(doneAt), "d MMM HH:mm", { locale: es })}`
                                          : imp.promotedAt !== null
                                            ? `· promovido ${format(new Date(imp.promotedAt), "d MMM HH:mm", { locale: es })}`
                                            : "· sin resolver"}
                                      </span>
                                    </p>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                      </li>
                    );
                  })}
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
