# Add Insights: vista de análisis global del trabajo

## Why

La app recolecta mucha señal que hoy casi no se muestra: la bitácora
`events` (tiempos por estado, reabiertas), tipos/áreas/executors de `tasks`,
duraciones de `agentRuns`, imprevistos y plan-vs-real. El catch-up muestra
una semana de patagonia y el drawer de imprevistos 7/30 días de una sola
métrica. Falta la vista que responda "¿qué valor produce este sistema?":
throughput, tiempos, distribución del trabajo, delegación al agente y el
coste real de los imprevistos.

## What Changes

- **Vista "Insights"** nueva en el Toolbar (junto a Kanban/Lista/Calendario/
  Catch-up/Agente), GLOBAL con filtro de área (todas/patagonia/datacef/
  personal) y selector de período (30 días / 90 días / todo el histórico).
- **Gráficos reales** con `recharts` (líneas, barras, donas, scatter) — la
  vista es de visualización; se justifica la dependencia (~50KB gz).
- Bloques (cada uno responde una pregunta):
  1. Resumen ejecutivo: completadas, % por el agente, ciclo promedio,
     imprevistos absorbidos, % resueltos el mismo día, plan-vs-real.
  2. Throughput: completadas vs creadas por semana.
  3. Tiempos: cycle time (creada→completada) por área y tipo; tiempo por
     estado desde `events` (con nota "solo tareas con bitácora").
  4. Distribución: por área, tipo, executor y proyecto de ClickUp
     (`clickupPath`); % sincronizado con ClickUp.
  5. Delegación: tareas del agente vs propias, horas delegadas (duración de
     corridas), tasa de éxito y duración por modelo.
  6. Imprevistos: por día, desglose por día de semana, % mismo día,
     tendencia semanal y correlación imprevistos vs planeadas completadas.
  7. Calidad: reabiertas, completadas a tiempo vs vencidas (dueDate), y
     envejecimiento del backlog vivo.
- **Backend**: `convex/insights.ts` con query de dataset que devuelve tareas,
  events del rango, imprevistos, dayItems y agentRuns (recortados); la
  agregación es client-side en hora local (patrón de todo el sistema).

## Impact

- Nuevos: `convex/insights.ts`, `src/components/InsightsView.tsx` (+ sub-
  componentes), view "insights" en Toolbar/App.
- Dependencia nueva: `recharts` (package.json + lockfile — sincronizar).
- No cambia: catch-up, panel Hoy, sync ClickUp, ninguna escritura.
