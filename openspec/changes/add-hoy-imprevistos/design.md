# Design: Hoy + Imprevistos

## Contexto

El tablero (`tasks`) es la fuente de verdad del trabajo trackeado y vive
sincronizado con ClickUp (área patagonia). Esta feature agrega una capa de
planificación diaria que NO debe contaminar el tablero: los imprevistos son
exactamente lo que NO está trackeado, meterlos en `tasks` obligaría a
filtrarlos de Kanban, ListView, CalendarView, catch-up, inbound y métricas.

## Decisiones

### 1. Tabla propia `imprevistos` (no filas de `tasks`)

La alternativa barata en sync (modelarlos como tasks con `clickupParentId`)
contamina todas las vistas y queries existentes con un flag "esImprevisto".
Tabla propia mantiene el invariante "tasks = tablero". El costo es un flujo
propio de sync ClickUp, contenido en `imprevistosSync.ts` y mucho más
acotado que `syncTask` (solo create/status/promote de subtasks).

### 2. El día lo calcula el cliente (patrón catch-up)

`day` = inicio de día en hora LOCAL calculado por el cliente (patrón
`startOfDay` de `catchupConfig.ts`, DST-safe). El backend solo compara
números; jamás decide qué día es hoy.

### 3. `open` desnormalizado

Convex no indexa bien "campo opcional undefined"; `open: boolean` se
mantiene en cada mutation y habilita el índice `by_open` para la sección
"abiertos de días anteriores" sin barrer toda la tabla.

### 4. Sync best-effort con sweep (sin cola de reintentos)

Igual que `syncTask`: el error queda en la fila (`clickupSyncError`), no se
relanza. El "reintento" es un sweep que corre cuando se crea o sincroniza
otro imprevisto: procesa las filas sin `clickupSubtaskId` y sin error
terminal. Si ClickUp está off (`clickup.enabled=false`, entorno dev sin
`forceSyncDev`), todo funciona local y el sweep es no-op.

### 5. Promoción: mover, con fallback de recrear

1. `clickup_update_task` quitando el parent → verificar con `get_task`.
2. Si el MCP ignoró/rechazó el cambio de parent: `clickup_delete_task` de
   la subtask + `clickup_create_task` top-level en Mesa Técnica (mismo
   título). Ambas tools ya se usan hoy en `clickup.ts`.
3. En ambos casos: internal mutation crea la tarea Hermes real (área
   patagonia, status pendiente, order 0, clickupId/Url/ListId enlazados,
   evento `created`) y marca el imprevisto `promotedAt`/`promotedTaskId`.

La tarea creada entra al flujo normal: aparece en el tablero, sincroniza
ediciones posteriores con `syncTask` como cualquier task.

### 6. Drop del panel dentro del DndContext del Kanban

El `DndContext` vive en `KanbanView`; el panel se monta dentro del board
para que `useDroppable` reciba las tarjetas. `findContainer` no conoce el
id del panel → `handleDragOver` es no-op natural (la tarjeta no se mueve
optimistamente de columna). En `handleDragEnd` un branch explícito ANTES de
la lógica de columnas commitea `hoy.add` sin tocar status. El reorden
interno del panel usa `SortableContext` propio con ids prefijados `hoy:`
para no colisionar con los ids de tareas.

### 7. Métricas derivadas de las tablas, no de events

Los imprevistos no son tasks, así que no emiten events (que exigen
`taskId`). La tabla `imprevistos` ES su bitácora: surgidos por `day`,
resueltos por `resolvedAt` (+ cruce mismo-día), promovidos por
`promotedAt`. El plan-vs-real cruza `dayItems` con `completedAt` de tasks.
La única task creada (promoción) emite el evento `created` estándar, con lo
que el catch-up la toma sin código extra.

### 8. Catch-up: sección congelada por construcción

`buildSummary` suma `unplanned` (imprevistos con `day` en ventana) y
`metrics.unplanned`; `close` reusa `buildSummary`, así el snapshot lo
congela solo. Snapshots viejos: accessor defensivo `unplannedOf(body) ?? []`
(precedente `queuedOf`/`pendingOf`).

## Riesgos y mitigaciones

- **Volumen de subtasks en Mesa Técnica infla el escaneo inbound**
  (`fetchAllListTasksWithParents` expande BFS): los imprevistos ya mapeados
  no se ofrecen como nuevas (están en `_listMappedForInbound` por su
  clickupId... no: están en tabla propia). Mitigación: el escaneo inbound
  corre sobre `tasks` mapeadas; las subtasks "Imprevistos Cris" asignadas a
  Cris SÍ aparecerían en `fetchMyAssignedTasks` → el filtro del inbound debe
  excluir por parent = imprevistosParentId.
- **MCP update sin parent**: cubierto por el fallback de recrear (decisión 5).
- **Drag accidental al panel**: el alta es aditiva y reversible (X quita del
  día, sin tocar la tarea).

## Open Questions

Ninguna bloqueante. Futuras (fuera de alcance v1): tamaño/tiempo por
imprevisto, área por imprevisto, panel en vistas Lista/Calendario.
