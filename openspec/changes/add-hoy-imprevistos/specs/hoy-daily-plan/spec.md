# Hoy Daily Plan Specification (delta)

## ADDED Requirements

### Requirement: Lista del día
El sistema SHALL ofrecer un panel "Hoy" (a la izquierda del Kanban,
contraíble, preferencia persistida) donde el usuario arma la lista de
prioridades del día agregando tareas del tablero de CUALQUIER estado, por
arrastre desde las columnas del Kanban o por un buscador sobre las tareas
cargadas. Agregar una tarea al día NO cambia su estado, ni su order en el
tablero, ni nada en ClickUp. Cada día tiene su propia lista (el día se
computa en hora local del cliente).

#### Scenario: Arrastrar una tarea urgente al panel
- **WHEN** el usuario arrastra una tarea desde cualquier columna del Kanban
  y la suelta sobre el panel Hoy
- **THEN** la tarea aparece en la sección Planeadas del día
- **AND** la tarea permanece en su columna original con su estado intacto

#### Scenario: Quitar del día
- **WHEN** el usuario presiona la X en una fila planeada
- **THEN** la tarea sale de la lista del día sin ningún cambio en la tarea

#### Scenario: Completar desde el día
- **WHEN** el usuario marca el check de una fila planeada
- **THEN** la tarea se completa con el flujo estándar del tablero
  (columna completado, progress 100, evento completed) y la fila queda
  resuelta en el día

### Requirement: Alta rápida de imprevistos
El sistema SHALL permitir crear imprevistos desde el panel Hoy con un solo
campo (título + Enter). Los imprevistos NO son tasks del tablero: viven en
la tabla `imprevistos` con día de surgimiento (hora local del cliente),
orden, resolución y promoción. Se pueden resolver (check), reabrir,
reordenar y borrar. Los imprevistos sin resolver de días anteriores SHALL
seguir visibles en una sección propia ("abiertos de días anteriores")
hasta resolverse o promoverse, con indicador de días que lleva abierto.

#### Scenario: Imprevisto que queda para otro día
- **WHEN** un imprevisto creado el lunes no se resuelve ese día
- **THEN** el martes aparece en "abiertos de días anteriores" con badge "día 2"
- **AND** al resolverlo, la métrica lo cuenta como surgido el lunes y NO
  resuelto el mismo día

### Requirement: Imprevistos como subtasks de ClickUp
El sistema SHALL sincronizar cada imprevisto como SUBTAREA de la tarea
"Imprevistos Cris" en la List Mesa Técnica del workspace Patagonia (padre
find-or-create con id cacheado). Al resolver/reabrir un imprevisto, la
subtask pasa a complete/to do. El sync es best-effort: corre bajo las
mismas guardas que el outbound (`clickup.enabled`, producción o
`forceSyncDev`, token presente); si ClickUp está desactivado o falla, el
imprevisto funciona 100% local, el error queda en la fila y un sweep
reintenta los pendientes en la próxima creación/sync. Las subtasks del
padre "Imprevistos Cris" SHALL ser excluidas del escaneo inbound para no
ofrecerse como tareas nuevas.

#### Scenario: Crear imprevisto con ClickUp activo
- **WHEN** se crea un imprevisto y el sync está habilitado
- **THEN** aparece una subtask bajo "Imprevistos Cris" en Mesa Técnica con
  el mismo título

#### Scenario: ClickUp caído
- **WHEN** la creación de la subtask falla
- **THEN** el imprevisto queda creado y operativo en Hermes
- **AND** la fila registra el error y el sweep lo reintenta más tarde

### Requirement: Promover imprevisto a tarea
El sistema SHALL permitir promover un imprevisto a tarea real desde el día
cero. La promoción crea una tarea Hermes normal (área patagonia, status
pendiente, order 0) enlazada a la tarea de primer nivel resultante en Mesa
Técnica (la subtask pierde su parent; si el MCP no soporta quitar parent,
se borra la subtask y se crea la tarea top-level en su lugar), marca el
imprevisto con promotedAt/promotedTaskId y emite el evento created. El
imprevisto deja de contar como "abierto".

#### Scenario: Promover
- **WHEN** el usuario promueve un imprevisto
- **THEN** en ClickUp la subtask pasa a ser tarea de primer nivel de Mesa
  Técnica
- **AND** en Hermes aparece una tarea nueva en pendiente, enlazada a esa
  tarea de ClickUp
- **AND** las métricas lo registran como promovido

### Requirement: Convertir tarea en imprevisto
El sistema SHALL permitir el camino inverso: convertir una tarea existente
del tablero en imprevisto del día. La conversión es un MOVE: la tarea se
borra con la semántica estándar de eliminación (borrado lógico de tarea y
subtareas, evento en la bitácora y DELETE de su contraparte en ClickUp) y
nace un imprevisto con el mismo título para el día actual, vinculado a la
tarea original (`movedFromTaskId`) para trazabilidad.

#### Scenario: Me equivoqué, esto era un imprevisto
- **WHEN** el usuario convierte una tarea sincronizada con ClickUp
- **THEN** la tarea desaparece del tablero y su tarea de ClickUp se borra
- **AND** aparece un imprevisto de hoy con el mismo título, que se crea
  como subtask de "Imprevistos Cris"

### Requirement: Métricas del día y visor de insights
El sistema SHALL persistir todo (imprevistos y dayItems en Convex) y
ofrecer un visor de insights con rango 7/30 días: por día, imprevistos
surgidos, resueltos el mismo día, quedaron abiertos, promovidos, y
plan-vs-real (planeadas vs completadas ese día); agregados de promedio de
imprevistos por día, % resueltos el mismo día, demora promedio de
resolución y listado de abiertos más viejos.

#### Scenario: Plan vs real
- **WHEN** un día tiene 4 planeadas y solo 2 completadas, con 3 imprevistos
- **THEN** el visor muestra 2/4 completadas y 3 imprevistos para ese día
