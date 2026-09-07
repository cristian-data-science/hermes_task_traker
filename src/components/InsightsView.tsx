/**
 * Vista Insights — el dashboard de análisis global del trabajo.
 *
 * ===== LA IDEA =====
 * Cada bloque responde UNA pregunta de negocio con datos reales del sistema:
 * cuánto se completa, cuánto tarda, dónde se distribuye, cuánto descarga el
 * agente, cuánto cuestan los imprevistos y qué tan sana está la operación.
 * Es la vista que justifica el sistema entero: el valor de lo que recogimos.
 *
 * ===== DATOS =====
 * Una sola query (`insights.dataset`) trae tareas + events + imprevistos +
 * dayItems + corridas del rango/área; toda la agregación es client-side con
 * date-fns en hora local (el calendario es del cliente, como en todo el
 * sistema). Los gráficos son recharts — SVG inline, así que los fills usan
 * las CSS vars del tema y los 4 temas quedan respetados sin código extra.
 *
 * ===== HONESTIDAD DE DATOS =====
 * Las métricas de camino (tiempo por estado, reabiertas) dependen de la
 * bitácora `events`: las tareas anteriores a la bitácora solo tienen
 * timestamps finales. Esos bloques se anotan "solo tareas con bitácora" en
 * vez de mentir con promedios incompletos.
 */
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  LineChart,
  Line,
} from "recharts";
import {
  addDays,
  differenceInCalendarDays,
  format,
  startOfDay,
  startOfWeek,
  isSameDay,
} from "date-fns";
import { es } from "date-fns/locale";
import type { FunctionReturnType } from "convex/server";
import { api } from "~/convex/_generated/api";
import { useAuth } from "../hooks/useAuth";
import { cn } from "../lib/utils";
import { parseTaskDates } from "../lib/dates";
import { AREAS, AREA_META, type Area } from "../lib/constants";

// ============================================================
//  Tipos del dataset
// ============================================================

type Dataset = FunctionReturnType<typeof api.insights.dataset>;
type TaskRow = Dataset["tasks"][number];

type Period = "30" | "90" | "all";
type AreaFilter = "all" | Area;

const PERIODS: { id: Period; label: string }[] = [
  { id: "30", label: "30 días" },
  { id: "90", label: "90 días" },
  { id: "all", label: "Todo" },
];

const AREA_FILTERS: { id: AreaFilter; label: string }[] = [
  { id: "all", label: "Todas" },
  ...AREAS.map((a) => ({ id: a as AreaFilter, label: AREA_META[a].label })),
];

const STATUS_ORDER = [
  "urgente",
  "pendiente",
  "en-curso",
  "standby",
  "programado",
  "completado",
] as const;

const STATUS_LABEL: Record<string, string> = {
  urgente: "Urgente",
  pendiente: "Pendiente",
  "en-curso": "En curso",
  standby: "Standby",
  programado: "Programado",
  completado: "Completado",
};

const TYPE_LABEL: Record<string, string> = {
  reporte: "Reporte",
  desarrollo: "Desarrollo",
  analisis: "Análisis",
  ops: "Ops",
  otro: "Otro",
};

const EXECUTOR_LABEL: Record<string, string> = {
  cris: "Cris",
  claw: "Claw",
  zcode: "ZCode",
  claude: "Claude Code",
};

/** Estilo compartido de tooltips recharts con los tokens del tema. */
const tooltipProps = {
  contentStyle: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text)",
    fontSize: 12,
    boxShadow: "var(--shadow-lg)",
  } as React.CSSProperties,
  labelStyle: { color: "var(--muted)", fontSize: 11 } as React.CSSProperties,
  cursor: { fill: "var(--surface-2)", opacity: 0.6 },
};

// ============================================================
//  Vista principal
// ============================================================

export function InsightsView() {
  const { token } = useAuth();
  const [period, setPeriod] = useState<Period>("30");
  const [areaFilter, setAreaFilter] = useState<AreaFilter>("all");

  // Áreas ocultas (el mismo setting que oculta chips/columnas en el tablero):
  // ocultar un área la saca de Insights también — de los botones del filtro
  // y de las métricas (el backend las excluye del dataset).
  const clickupState = useQuery(
    api.settings.getClickupState,
    token ? { sessionToken: token } : "skip",
  );
  const hiddenAreas = useMemo(
    () => new Set((clickupState?.hiddenAreas ?? []) as string[]),
    [clickupState],
  );
  const areaButtons = AREA_FILTERS.filter((a) => !hiddenAreas.has(a.id));
  // Si el área seleccionada termina oculta, la vista cae a "Todas".
  const effectiveArea: AreaFilter = hiddenAreas.has(areaFilter) ? "all" : areaFilter;

  const to = startOfDay(addDays(new Date(), 1)).getTime();
  const from =
    period === "all" ? 0 : startOfDay(addDays(new Date(), -(Number(period) - 1))).getTime();

  const data = useQuery(
    api.insights.dataset,
    token ? { sessionToken: token, from, to, area: effectiveArea } : "skip",
  );

  const taskById = useMemo(() => {
    const m = new Map<string, TaskRow>();
    for (const t of data?.tasks ?? []) m.set(t.id, t);
    return m;
  }, [data]);

  // ---- Métricas base -----------------------------------------------------
  const m = useMemo(() => computeMetrics(data, taskById, to), [data, taskById, to]);

  const empty = !data || data.tasks.length === 0;

  return (
    <div className="space-y-5">
      {/* ===== Header: título + filtros ===== */}
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink">Insights</h2>
          <p className="text-xs text-faint">
            El valor de lo que recopila el sistema, en una sola vista.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-el border-el border-line bg-panel2 p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={cn(
                  "rounded-el px-2 py-1 text-xs font-medium transition-colors",
                  period === p.id ? "bg-panel text-ink shadow-el" : "text-faint hover:text-ink",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-el border-el border-line bg-panel2 p-0.5">
            {areaButtons.map((a) => (
              <button
                key={a.id}
                onClick={() => setAreaFilter(a.id)}
                className={cn(
                  "rounded-el px-2 py-1 text-xs font-medium transition-colors",
                  areaFilter === a.id ? "bg-panel text-ink shadow-el" : "text-faint hover:text-ink",
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {empty ? (
        <div className="rounded-el-lg border-el border-dashed border-line px-4 py-10 text-center text-sm text-faint">
          No hay tareas en este período/área todavía.
        </div>
      ) : (
        <>
          {/* ===== 1. Resumen ejecutivo ===== */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <StatCard
              value={String(m.completadas.length)}
              label="Tareas completadas"
              hint={`${m.pctAgent === null ? "—" : m.pctAgent}% por el agente`}
            />
            <StatCard
              value={m.cycleMedian === null ? "—" : `${m.cycleMedian} d`}
              label="Ciclo (mediana)"
              hint="de creada a completada"
            />
            <StatCard
              value={String(m.imprevistos.surgidos)}
              label="Imprevistos"
              hint={`${m.imprevistos.mismoDiaPct ?? "—"}% resueltos el mismo día`}
            />
            <StatCard
              value={`${m.plan.hechas}/${m.plan.total}`}
              label="Plan vs real"
              hint="planeadas completadas"
            />
            <StatCard
              value={`${m.horasDelegadas.toFixed(1)} h`}
              label="Delegadas al agente"
              hint={`${m.runsTerminadas} corridas`}
            />
            <StatCard
              value={`${m.onTimePct ?? "—"}%`}
              label="A tiempo"
              hint={`${m.onTime} de ${m.onTime + m.vencidas} con vencimiento`}
            />
          </div>

          {/* ===== 2. Throughput ===== */}
          <ChartCard
            title="Throughput semanal"
            note="Creadas vs completadas por semana — el pulso del sistema."
          >
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={m.throughput} barGap={2}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  axisLine={{ stroke: "var(--border)" }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip {...tooltipProps} />
                <Bar dataKey="creadas" name="Creadas" fill="var(--faint)" radius={[3, 3, 0, 0]} />
                <Bar
                  dataKey="completadas"
                  name="Completadas"
                  fill="var(--status-completado)"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* ===== 3. Tiempos ===== */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartCard
              title="Ciclo por área y tipo"
              note="Mediana de días de creada a completada."
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={m.cycleByGroup} layout="vertical">
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                    axisLine={{ stroke: "var(--border)" }}
                    tickLine={false}
                    unit=" d"
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tick={{ fill: "var(--text)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={110}
                  />
                  <Tooltip {...tooltipProps} />
                  <Bar dataKey="dias" name="Mediana (días)" fill="var(--accent)" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Dónde se traba el trabajo"
              note="Promedio de días por estado según la bitácora — solo tareas con bitácora."
            >
              {m.tiempoPorEstado.length === 0 ? (
                <p className="px-1 py-8 text-center text-xs text-faint">
                  Sin eventos de flujo en este rango todavía.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={m.tiempoPorEstado} layout="vertical">
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                      axisLine={{ stroke: "var(--border)" }}
                      tickLine={false}
                      unit=" d"
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      tick={{ fill: "var(--text)", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={110}
                    />
                    <Tooltip {...tooltipProps} />
                    <Bar dataKey="dias" name="Promedio (días)" radius={[0, 3, 3, 0]}>
                      {m.tiempoPorEstado.map((s) => (
                        <Cell key={s.label} fill={`var(--status-${s.key})`} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          {/* ===== 4. Distribución ===== */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {areaFilter === "all" && (
              <ChartCard title="Por área" note="Completadas del período.">
                <Donut data={m.byArea} />
              </ChartCard>
            )}
            <ChartCard title="Por tipo" note="Completadas del período.">
              <Donut data={m.byType} />
            </ChartCard>
            <ChartCard title="Quién las cerró" note="Completadas del período.">
              <Donut data={m.byExecutor} />
            </ChartCard>
            <ChartCard
              title="ClickUp"
              note={
                m.clickup.pct === null
                  ? "Sin tareas de patagonia en el rango."
                  : `${m.clickup.pct}% de patagonia sincronizada · ${m.clickup.desvinculadas} desvinculadas`
              }
            >
              <Donut data={m.clickup.sincronizadas} />
            </ChartCard>
          </div>

          {m.byProyecto.length > 0 && (
            <ChartCard
              title="Trabajo por proyecto de ClickUp"
              note="Completadas agrupadas por proyecto (list) de ClickUp."
            >
              <ResponsiveContainer width="100%" height={Math.max(140, m.byProyecto.length * 34)}>
                <BarChart data={m.byProyecto} layout="vertical">
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                    axisLine={{ stroke: "var(--border)" }}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tick={{ fill: "var(--text)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={150}
                  />
                  <Tooltip {...tooltipProps} />
                  <Bar
                    dataKey="valor"
                    name="Completadas"
                    fill="var(--area-patagonia)"
                    radius={[0, 3, 3, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {/* ===== 5. Delegación ===== */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartCard
              title="Delegación al agente"
              note="Cómo le fue al ZCode en el período."
            >
              <div className="grid grid-cols-2 gap-2 p-1">
                <MiniStat
                  value={`${m.pctAgent === null ? "—" : m.pctAgent}%`}
                  label="de las completadas las cerró el agente"
                />
                <MiniStat
                  value={`${m.horasDelegadas.toFixed(1)} h`}
                  label="de corridas del agente (tiempo máquina)"
                />
                <MiniStat
                  value={m.exitoAgente === null ? "—" : `${m.exitoAgente}%`}
                  label="corridas con éxito"
                />
                <MiniStat
                  value={m.modelos.length === 0 ? "—" : `${m.modelos.length}`}
                  label={`modelo${m.modelos.length === 1 ? "" : "s"} usado${m.modelos.length === 1 ? "" : "s"}`}
                />
              </div>
              {m.modelos.length > 0 && (
                <div className="mt-2 space-y-1 px-1">
                  {m.modelos.map((mo) => (
                    <p key={mo.label} className="flex items-center gap-2 text-xs text-mute">
                      <span className="min-w-0 flex-1 truncate font-mono">{mo.label}</span>
                      <span className="text-faint">
                        {mo.corradas} corridas · {mo.duracionProm.toFixed(1)} min prom
                      </span>
                    </p>
                  ))}
                </div>
              )}
            </ChartCard>

            {/* ===== 6. Imprevistos ===== */}
            <ChartCard
              title="Imprevistos: el ruido por día de semana"
              note="Dónde se acumula el trabajo no trackeado."
            >
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={m.imprevistos.weekday}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                    axisLine={{ stroke: "var(--border)" }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip {...tooltipProps} />
                  <Bar dataKey="valor" name="Imprevistos" fill="var(--accent)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* ===== 7. La correlación estrella ===== */}
          <ChartCard
            title="El coste del ruido"
            note="Cada punto es un día: imprevistos surgidos vs % de planeadas completadas. Si la nube baja a la derecha, el ruido te come lo planificado."
          >
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <ResponsiveContainer width="100%" height={230}>
                  <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 0 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name="Imprevistos"
                      allowDecimals={false}
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                      axisLine={{ stroke: "var(--border)" }}
                      tickLine={false}
                      label={{
                        value: "imprevistos del día",
                        position: "insideBottom",
                        offset: -12,
                        fill: "var(--faint)",
                        fontSize: 11,
                      }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name="% planeadas hechas"
                      domain={[0, 100]}
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={40}
                      unit="%"
                    />
                    <Tooltip {...tooltipProps} />
                    <Scatter
                      name="Días"
                      data={m.correlacion.puntos}
                      fill="var(--accent)"
                      fillOpacity={0.75}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col justify-center gap-2">
                <MiniStat
                  value={`${m.correlacion.tranquilos.pct}%`}
                  label={`de planeadas completadas en días tranquilos (≤2 imprevistos, ${m.correlacion.tranquilos.dias} días)`}
                />
                <MiniStat
                  value={`${m.correlacion.ruidosos.pct}%`}
                  label={`en días ruidosos (3+ imprevistos, ${m.correlacion.ruidosos.dias} días)`}
                />
                <p className="text-[11px] leading-snug text-faint">
                  {m.correlacion.tranquilos.dias === 0 || m.correlacion.ruidosos.dias === 0
                    ? "Todavía no hay suficientes días de ambos tipos para comparar."
                    : m.correlacion.ruidosos.pct < m.correlacion.tranquilos.pct
                      ? "Los días ruidosos completás MENOS de lo planeado: cada imprevisto tiene costo visible."
                      : "Por ahora el ruido no te está comiendo lo planificado. Seguí midiendo."}
                </p>
              </div>
            </div>
          </ChartCard>

          {/* ===== 8. Calidad ===== */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartCard
              title="Salud del backlog"
              note="Tareas vivas por antigüedad desde su creación."
            >
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={m.backlogAging}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                    axisLine={{ stroke: "var(--border)" }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip {...tooltipProps} />
                  <Bar dataKey="valor" name="Tareas" radius={[3, 3, 0, 0]}>
                    {m.backlogAging.map((b) => (
                      <Cell key={b.label} fill={b.tone} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="mt-1 px-1 text-[11px] text-faint">
                {m.reabiertas > 0
                  ? `${m.reabiertas} reapertura${m.reabiertas === 1 ? "" : "es"} en el período (trabajo que volvió).`
                  : "Sin reaperturas en el período."}
              </p>
            </ChartCard>

            {/* Tendencia semanal de imprevistos: cierra el círculo del panel Hoy */}
            <ChartCard
              title="Tendencia de imprevistos"
              note="Surgidos por semana — ¿está bajando el ruido?"
            >
              {m.imprevistos.semanal.length < 2 ? (
                <p className="px-1 py-8 text-center text-xs text-faint">
                  Se necesitan al menos dos semanas de datos.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={m.imprevistos.semanal}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                      axisLine={{ stroke: "var(--border)" }}
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={28}
                    />
                    <Tooltip {...tooltipProps} />
                    <Line
                      type="monotone"
                      dataKey="valor"
                      name="Imprevistos"
                      stroke="var(--accent)"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "var(--accent)" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
//  Cálculo de métricas (client-side, hora local)
// ============================================================

function computeMetrics(data: Dataset | undefined, taskById: Map<string, TaskRow>, to: number) {
  const tasks = data?.tasks ?? [];
  const events = data?.events ?? [];
  const imprevistos = data?.imprevistos ?? [];
  const dayItems = data?.dayItems ?? [];
  const runs = data?.agentRuns ?? [];

  const inRange = (t?: number | null) => t !== null && t !== undefined && t < to && t >= 0;

  // ---- Completadas / creadas del rango ------------------------------------
  const completadas = tasks.filter((t) => t.completedAt !== null && inRange(t.completedAt));
  const creadas = tasks.filter((t) => inRange(t.createdAt));
  const byAgent = completadas.filter(
    (t) => t.executor === "zcode" || t.executor === "claude",
  );
  const pctAgent = completadas.length > 0 ? Math.round((byAgent.length / completadas.length) * 100) : null;

  // ---- Cycle time (created → completed) -----------------------------------
  const cycles = completadas.map((t) =>
    differenceInCalendarDays(new Date(t.completedAt!), new Date(t.createdAt)),
  );
  const median = (arr: number[]) =>
    arr.length === 0 ? null : [...arr].sort((a, b) => a - b)[Math.floor((arr.length - 1) / 2)];
  const cycleMedian = median(cycles);

  const groupCycles = new Map<string, number[]>();
  const pushCycle = (key: string, v: number) => {
    const arr = groupCycles.get(key) ?? [];
    arr.push(v);
    groupCycles.set(key, arr);
  };
  for (const t of completadas) {
    const d = differenceInCalendarDays(new Date(t.completedAt!), new Date(t.createdAt));
    pushCycle(`área:${AREA_META[t.area as Area]?.label ?? t.area}`, d);
    pushCycle(
      `tipo:${t.taskType ? TYPE_LABEL[t.taskType] ?? t.taskType : "sin tipo"}`,
      d,
    );
  }
  const cycleByGroup = [...groupCycles.entries()]
    .map(([label, arr]) => ({
      label: label.includes(":") ? label.split(":")[1] : label,
      grupo: label.split(":")[0],
      dias: median(arr) ?? 0,
    }))
    .sort((a, b) => b.dias - a.dias);

  // ---- Throughput semanal --------------------------------------------------
  const weekKey = (ts: number) => startOfWeek(new Date(ts), { weekStartsOn: 1 }).getTime();
  const weeks = new Map<number, { creadas: number; completadas: number }>();
  const weekBucket = (ts: number) => {
    const k = weekKey(ts);
    const b = weeks.get(k) ?? { creadas: 0, completadas: 0 };
    weeks.set(k, b);
    return b;
  };
  for (const t of creadas) weekBucket(t.createdAt).creadas++;
  for (const t of completadas) weekBucket(t.completedAt!).completadas++;
  const throughput = [...weeks.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-16)
    .map(([k, v]) => ({
      label: format(new Date(k), "d MMM", { locale: es }),
      ...v,
    }));

  // ---- Tiempo por estado (desde events; nota: solo tareas con bitácora) ----
  const byTaskEvents = new Map<string, typeof events>();
  for (const e of events) {
    const arr = byTaskEvents.get(e.taskId) ?? [];
    arr.push(e);
    byTaskEvents.set(e.taskId, arr);
  }
  const stateMs = new Map<string, number>();
  const stateCount = new Map<string, number>();
  for (const evs of byTaskEvents.values()) {
    const sorted = [...evs].sort((a, b) => a.at - b.at);
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      // El estado VIGENTE después del evento e es e.to (created/status/
      // reopened lo setean; completed/deleted son terminales).
      if (e.kind === "completed" || e.kind === "deleted") continue;
      const estado = e.to ?? "pendiente";
      const end = sorted[i + 1]?.at ?? Math.min(to, Date.now());
      const dur = end - e.at;
      if (dur > 0) {
        stateMs.set(estado, (stateMs.get(estado) ?? 0) + dur);
        stateCount.set(estado, (stateCount.get(estado) ?? 0) + 1);
      }
    }
  }
  const tiempoPorEstado = STATUS_ORDER.map((s) => ({
    key: s,
    label: STATUS_LABEL[s],
    dias: stateCount.has(s)
      ? Math.round(((stateMs.get(s) ?? 0) / stateCount.get(s)!) / 86400000 * 10) / 10
      : 0,
  })).filter((s) => stateCount.has(s.key));

  // ---- Distribución ---------------------------------------------------------
  const donut = (rows: { label: string; valor: number; color: string }[]) =>
    rows.filter((r) => r.valor > 0);

  const byArea = donut(
    AREAS.map((a) => ({
      label: AREA_META[a].label,
      valor: completadas.filter((t) => t.area === a).length,
      color: `var(--area-${a})`,
    })),
  );

  const TYPES = ["reporte", "desarrollo", "analisis", "ops", "otro"];
  const typeColors = [
    "var(--accent)",
    "var(--status-en-curso)",
    "var(--area-datacef)",
    "var(--status-programado)",
    "var(--faint)",
  ];
  const byType = donut(
    TYPES.map((ty, i) => ({
      label: TYPE_LABEL[ty],
      valor: completadas.filter((t) => t.taskType === ty).length,
      color: typeColors[i],
    })),
  );
  // "Sin tipo" aparte (tareas previas a la capa agente).
  const sinTipo = completadas.filter((t) => !t.taskType).length;
  if (sinTipo > 0) byType.push({ label: "Sin tipo", valor: sinTipo, color: "var(--border-strong)" });

  const EXECS = ["cris", "claw", "zcode", "claude"];
  const execColors = [
    "var(--accent)",
    "var(--status-programado)",
    "var(--status-en-curso)",
    "#f97316",
  ];
  const byExecutor = donut(
    EXECS.map((x, i) => ({
      label: EXECUTOR_LABEL[x],
      valor: completadas.filter((t) => t.executor === x).length,
      color: execColors[i],
    })),
  );
  const sinExecutor = completadas.filter((t) => !t.executor).length;
  if (sinExecutor > 0)
    byExecutor.push({ label: "Sin asignar", valor: sinExecutor, color: "var(--border-strong)" });

  const patagoniaTasks = tasks.filter((t) => t.area === "patagonia" && t.deletedAt === null);
  const sincronizadas = patagoniaTasks.filter((t) => t.clickupId !== null);
  const desvinculadas = patagoniaTasks.filter(
    (t) => t.clickupId !== null && (t as TaskRow & { clickupDetached?: boolean }).clickupDetached,
  ).length;
  const clickup = {
    sincronizadas: donut([
      { label: "Sincronizadas", valor: sincronizadas.length, color: "var(--area-patagonia)" },
      {
        label: "Solo locales",
        valor: patagoniaTasks.length - sincronizadas.length,
        color: "var(--border-strong)",
      },
    ]),
    pct: patagoniaTasks.length > 0 ? Math.round((sincronizadas.length / patagoniaTasks.length) * 100) : null,
    desvinculadas,
  };

  const proyectos = new Map<string, number>();
  for (const t of completadas) {
    if (!t.clickupId) continue;
    const p = t.clickupProject ?? "Sin proyecto";
    proyectos.set(p, (proyectos.get(p) ?? 0) + 1);
  }
  const byProyecto = [...proyectos.entries()]
    .map(([label, valor]) => ({ label, valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 8);

  // ---- Delegación -----------------------------------------------------------
  const runsTerminadas = runs.filter((r) => r.endedAt !== null);
  const horasDelegadas =
    runsTerminadas.reduce((s, r) => s + (r.endedAt! - r.startedAt), 0) / 3600000;
  const exitoRuns = runs.filter((r) => r.state === "hecho").length;
  const exitoAgente =
    runsTerminadas.length > 0 ? Math.round((exitoRuns / runsTerminadas.length) * 100) : null;
  const byModel = new Map<string, { total: number; ms: number }>();
  for (const r of runsTerminadas) {
    const k = (r.model ?? "desconocido").split("/").pop() ?? "?";
    const b = byModel.get(k) ?? { total: 0, ms: 0 };
    b.total++;
    b.ms += r.endedAt! - r.startedAt;
    byModel.set(k, b);
  }
  const modelos = [...byModel.entries()]
    .map(([label, b]) => ({
      label,
      corradas: b.total,
      duracionProm: b.ms / b.total / 60000,
    }))
    .sort((a, b) => b.corradas - a.corradas);

  // ---- Imprevistos ----------------------------------------------------------
  const today = startOfDay(new Date()).getTime();
  const doneAtOf = (i: Dataset["imprevistos"][number]) => {
    const task = i.promotedTaskId ? taskById.get(i.promotedTaskId) : undefined;
    return i.promotedAt !== null && task?.status === "completado"
      ? (task.completedAt ?? null)
      : i.resolvedAt;
  };
  const mismoDia = imprevistos.filter(
    (i) => doneAtOf(i) !== null && isSameDay(new Date(doneAtOf(i)!), new Date(i.day)),
  ).length;
  const weekdayCounts = new Array(7).fill(0) as number[];
  const perDay = new Map<number, number>();
  for (const i of imprevistos) {
    weekdayCounts[new Date(i.day).getDay()]++;
    perDay.set(i.day, (perDay.get(i.day) ?? 0) + 1);
  }
  const weekday = weekdayCounts
    .map((valor, idx) => ({
      label: format(new Date(2024, 0, idx + 1), "EEEE", { locale: es }),
      valor,
    }))
    .map((d) => ({ ...d, label: d.label.charAt(0).toUpperCase() + d.label.slice(1) }));

  const semanalMap = new Map<number, number>();
  for (const [day, n] of perDay) {
    const k = weekKey(day);
    semanalMap.set(k, (semanalMap.get(k) ?? 0) + n);
  }
  const semanal = [...semanalMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, valor]) => ({ label: format(new Date(k), "d MMM", { locale: es }), valor }));

  // Plan por día (para la correlación): día → {planeadas, hechas}.
  const planPorDia = new Map<number, { total: number; hechas: number }>();
  for (const item of dayItems) {
    const b = planPorDia.get(item.day) ?? { total: 0, hechas: 0 };
    const task = taskById.get(item.taskId);
    if (task && task.deletedAt === null) {
      b.total++;
      if (task.status === "completado") b.hechas++;
    }
    planPorDia.set(item.day, b);
  }
  const correlacionPuntos = [...planPorDia.entries()]
    .filter(([, b]) => b.total > 0)
    .map(([day, b]) => ({
      x: perDay.get(day) ?? 0,
      y: Math.round((b.hechas / b.total) * 100),
      dia: format(new Date(day), "d MMM", { locale: es }),
    }));
  const pctOf = (days: number[]) =>
    days.length === 0 ? null : Math.round(days.reduce((s, v) => s + v, 0) / days.length);
  const tranquilosYs = correlacionPuntos.filter((p) => p.x <= 2).map((p) => p.y);
  const ruidososYs = correlacionPuntos.filter((p) => p.x >= 3).map((p) => p.y);
  const correlacion = {
    puntos: correlacionPuntos,
    tranquilos: { dias: tranquilosYs.length, pct: pctOf(tranquilosYs) ?? 0 },
    ruidosos: { dias: ruidososYs.length, pct: pctOf(ruidososYs) ?? 0 },
  };

  // ---- Plan vs real total (mismas reglas que el drawer) ---------------------
  let planTotal = 0;
  let planHechas = 0;
  for (const [, b] of planPorDia) {
    planTotal += b.total;
    planHechas += b.hechas;
  }

  // ---- Calidad ----------------------------------------------------------------
  const reabiertas = events.filter((e) => e.kind === "reopened").length;

  let onTime = 0;
  let vencidas = 0;
  for (const t of completadas) {
    if (!t.dueDate) continue;
    const due = parseTaskDates(t.dueDate)[0];
    if (!due) continue;
    const dueDay = startOfDay(due).getTime();
    if (startOfDay(new Date(t.completedAt!)).getTime() <= dueDay) onTime++;
    else vencidas++;
  }
  const onTimePct = onTime + vencidas > 0 ? Math.round((onTime / (onTime + vencidas)) * 100) : null;

  const vivas = tasks.filter((t) => t.deletedAt === null && t.status !== "completado");
  const age = (t: TaskRow) => differenceInCalendarDays(new Date(today), new Date(t.createdAt));
  const backlogAging = [
    { label: "< 7 días", valor: vivas.filter((t) => age(t) < 7).length, tone: "var(--status-completado)" },
    {
      label: "7 a 30 días",
      valor: vivas.filter((t) => age(t) >= 7 && age(t) <= 30).length,
      tone: "var(--accent)",
    },
    { label: "> 30 días", valor: vivas.filter((t) => age(t) > 30).length, tone: "var(--danger)" },
  ];

  return {
    completadas,
    pctAgent,
    cycleMedian,
    cycleByGroup,
    throughput,
    tiempoPorEstado,
    byArea,
    byType,
    byExecutor,
    byProyecto,
    clickup,
    horasDelegadas,
    runsTerminadas: runsTerminadas.length,
    exitoAgente,
    modelos,
    imprevistos: {
      surgidos: imprevistos.length,
      mismoDiaPct: imprevistos.length > 0 ? Math.round((mismoDia / imprevistos.length) * 100) : null,
      weekday,
      semanal,
    },
    correlacion,
    plan: { total: planTotal, hechas: planHechas },
    reabiertas,
    onTime,
    vencidas,
    onTimePct,
    backlogAging,
  };
}

// ============================================================
//  Piezas de UI
// ============================================================

/** Tarjeta de número del resumen ejecutivo. */
function StatCard({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="rounded-el border-el border-line bg-panel2/60 px-3 py-2.5">
      <p className="text-xl font-semibold leading-tight text-ink">{value}</p>
      <p className="mt-0.5 text-[11px] font-medium leading-tight text-mute">{label}</p>
      {hint && <p className="text-[10px] leading-tight text-faint">{hint}</p>}
    </div>
  );
}

/** Stat chico para bloques internos. */
function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-el border-el border-line bg-panel2/60 px-3 py-2">
      <p className="text-base font-semibold leading-tight text-ink">{value}</p>
      <p className="mt-0.5 text-[10px] leading-tight text-faint">{label}</p>
    </div>
  );
}

/** Contenedor de bloque con título y nota. */
function ChartCard({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-el-lg border-el border-line bg-panel p-3 shadow-el">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-mute">{title}</h3>
      {note && <p className="mb-2 mt-0.5 text-[11px] leading-snug text-faint">{note}</p>}
      {children}
    </section>
  );
}

/** Dona estándar para distribuciones. */
function Donut({ data }: { data: { label: string; valor: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.valor, 0);
  if (total === 0) {
    return <p className="py-8 text-center text-xs text-faint">Sin datos en el período.</p>;
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <ResponsiveContainer width="100%" height={150}>
        <PieChart>
          <Tooltip {...tooltipProps} />
          <Pie
            data={data}
            dataKey="valor"
            nameKey="label"
            innerRadius={38}
            outerRadius={60}
            paddingAngle={2}
            stroke="var(--surface)"
          >
            {data.map((d) => (
              <Cell key={d.label} fill={d.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <ul className="flex w-full flex-col gap-0.5 px-2 pb-1">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-2 text-[11px] text-mute">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.color }} />
            <span className="min-w-0 flex-1 truncate">{d.label}</span>
            <span className="shrink-0 font-medium text-ink">
              {d.valor} · {Math.round((d.valor / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
