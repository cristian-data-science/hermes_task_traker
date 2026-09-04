# Tasks: vista Insights

## 1. Base

- [ ] 1.1 Rama `agent/insights-vista` desde master.
- [ ] 1.2 `npm install recharts` (verificar lockfile commiteado junto).
- [ ] 1.3 `convex/insights.ts`: query `dataset` (tasks + events del rango +
      imprevistos + dayItems + agentRuns, recortados y filtrables por área).

## 2. Frontend

- [ ] 2.1 Toolbar: view "insights" (ícono + label). App: render con
     (tasks ya cargadas las provee el dataset; no necesita props de tareas).
- [ ] 2.2 `InsightsView.tsx`: filtros (período + área) y layout de secciones.
- [ ] 2.3 Resumen ejecutivo (stat cards).
- [ ] 2.4 Throughput (barras semanales creadas vs completadas).
- [ ] 2.5 Tiempos: cycle time por área/tipo + tiempo por estado (nota
      bitácora).
- [ ] 2.6 Distribución: área/tipo/executor (donas) + proyecto ClickUp
      (barras) + % sincronizado.
- [ ] 2.7 Delegación: por executor, horas delegadas, éxito y duración por
      modelo.
- [ ] 2.8 Imprevistos: por día, weekday, mismo día, scatter correlación +
      días tranquilos vs ruidosos.
- [ ] 2.9 Calidad: reabiertas, a tiempo vs vencidas, backlog aging.

## 3. Verificación

- [ ] 3.1 `npx convex typecheck` + `npx tsc -b` + `npm run build`.
- [ ] 3.2 Push de funciones al deployment dev y smoke en localhost.
- [ ] 3.3 Reporte para revisión de Cris (SIN merge a master hasta su OK).
