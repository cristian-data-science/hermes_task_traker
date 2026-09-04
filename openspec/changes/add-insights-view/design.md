# Design: vista Insights

## Decisiones

### 1. Una query de dataset, agregación client-side
`insights.dataset({sessionToken, from, to, area?})` devuelve filas recortadas:
tasks (id, título, área, estado, tipo, executor, fechas clave, dueDate,
clickupPath.listName, clickupId), events del rango (kind, at, taskId,
fromStatus/toStatus — solo kinds de flujo), imprevistos + dayItems del rango
(reusa la forma de statsRange/listRange) y agentRuns (modelo, startedAt,
endedAt, state, exitCode). Volumen personal: miles de filas como máximo; la
agregación en el cliente con date-fns es trivial y mantiene el patrón "el
calendario es del cliente" (DST incluido) de todo el sistema.

### 2. Events solo desde que existe la bitácora
Las tareas anteriores a `events` solo tienen timestamps finales. Las métricas
que dependen del camino (tiempo por estado, reabiertas) se calculan SOLO con
tareas que tienen bitácora y se anotan "solo tareas con bitácora" en la UI.
Las métricas de timestamps finales (cycle time created→completed, throughput)
cubren todo el histórico.

### 3. recharts con colores del tema
recharts renderiza SVG inline: `fill="var(--status-en-curso)"` funciona y la
vista respeta los 4 temas (matrix/terminal/paper/brutal) sin código extra.
Ejes y tooltips en español.

### 4. Área como filtro global
El catch-up es solo patagonia; Insights es global por diseño (ver el trabajo
completo es el punto). El filtro filtra tasks/events/imprevistos no — los
imprevistos no tienen área; se muestran siempre (son globales por naturaleza).

### 5. Delegación y ClickUp
- Delegación: tasks por executor + duración de agentRuns (endedAt-startedAt
  de corridas terminadas) como "horas delegadas".
- ClickUp: agrupación por `clickupPath.listName` (proyecto) de las tasks
  sincronizadas; % sincronizado = tasks con clickupId / totales del área
  patagonia (las otras áreas nunca sincronizan y no cuentan al denominador).

### 6. Correlación imprevistos vs plan
Por día: x = imprevistos surgidos, y = % de planeadas completadas. Scatter
con los días del rango; más dos promedios agregados (días "tranquilos" ≤2
vs "ruidosos" ≥3) para que la conclusión se lea sin interpretar el gráfico.

## Riesgos

- `recharts` nueva dependencia: sincronizar lockfile en el merge (el CI usa
  frozen-lockfile — ya sufrido en producción).
- Volumen de events en "todo el histórico": si crece, mover la agregación de
  tiempos-por-estado al backend; por ahora es aceptable.
- Snapshots de catchup NO se tocan: Insights siempre recalcula en vivo.

## Fuera de alcance (v1)

- Métricas de correos (nuevo/procesado) y cumplimiento de compromisos
  semanales — candidatos a fase 2.
- Export/share del dashboard.
