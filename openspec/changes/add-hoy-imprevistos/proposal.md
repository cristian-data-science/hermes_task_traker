# Add Hoy + Imprevistos: lista de prioridades del día con registro de trabajo no trackeado

## Why

Cris arranca el día sacando tareas de distintas columnas del Kanban y quiere
una lista de prioridades "para hoy". Durante el día van surgiendo tareas que
no están registradas en el tablero (imprevistos) y hoy no hay forma de medir
cuántas surgen por día ni cuánto le quitan a lo planificado. El objetivo de
la feature es doble: una lista de trabajo del día Y un instrumento de
medición del trabajo no trackeado.

## What Changes

- **Panel "Hoy"** (izquierda del Kanban, contraíble): lista del día con tres
  secciones — Planeadas (punteros a tareas del tablero, de cualquier estado,
  sin tocar su status), Imprevistos (alta rápida de un campo) y Abiertos de
  días anteriores (imprevistos sin resolver, visibles hasta cerrarse).
- **Tabla `imprevistos`** (nueva): NO son tasks del tablero; viven en Convex
  con día de surgimiento, resolución y promoción, para análisis histórico.
- **Tabla `dayItems`** (nueva): punteros tarea⇄día con orden y arrastre
  (`carriedFrom` cuando se traen de otro día).
- **Sync ClickUp de imprevistos**: cada imprevisto se crea como SUBTAREA de
  la tarea "Imprevistos Cris" (List Mesa Técnica). Al resolver, la subtask
  pasa a complete. Al promover, deja de ser subtask y pasa a tarea de primer
  nivel en Mesa Técnica, enlazada como tarea Hermes normal.
- **Visor de insights**: métricas por día (surgidos, resueltos mismo día,
  quedaron abiertos, promovidos, plan-vs-real) + agregados (promedio/día,
  % resueltos mismo día, demora promedio, abiertos más viejos).
- **Catch-up semanal**: sección retráctil "Imprevistos" (cuántos y cuáles
  surgieron en la ventana), congelada en el snapshot como el resto.

## Escrituras en ClickUp (workspace real Patagonia)

Según regla del config.yaml, detalle explícito de qué toca el workspace:

- **Crea**: una tarea raíz "Imprevistos Cris" en Mesa Técnica (solo si no
  existe; id cacheado en settings `clickup.imprevistosParentId`). Una
  subtask bajo ese padre POR CADA imprevisto creado en Hermes.
- **Actualiza**: status de la subtask ("complete" al resolver, "to do" al
  reabrir). Al promover: intenta quitarle el parent (mover la MISMA subtask
  a primer nivel de Mesa Técnica).
- **Borra**: solo en el fallback de promoción, si el MCP no soporta quitar
  parent — se borra la subtask y se crea la tarea top-level en su lugar
  (mismo título, nueva tarea). Nada más se borra jamás.
- **Guardas**: idénticas al sync outbound existente — `clickup.enabled`,
  `isProductionDeployment()` o override `clickup.forceSyncDev`, token OAuth
  MCP presente. Si ClickUp está desactivado o falla, los imprevistos
  funcionan 100% local y el error queda registrado en la fila
  (`clickupSyncError`), con sweep de pendientes al crear el próximo.

## Impact

- Nuevos archivos: `convex/imprevistos.ts`, `convex/imprevistosSync.ts`,
  `convex/hoy.ts`, `src/components/HoyPanel.tsx`, `src/components/InsightsDrawer.tsx`.
- Modificados: `convex/schema.ts` (2 tablas), `convex/catchups.ts`
  (buildSummary), `src/lib/catchupSummary.ts`, `src/components/CatchupView.tsx`,
  `src/components/KanbanView.tsx` (montaje del panel + drop).
- No cambia: flujo de tasks, subtasks locales, auth, sync outbound de tasks.
