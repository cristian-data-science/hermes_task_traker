# Insights View Specification (delta)

## ADDED Requirements

### Requirement: Vista Insights global con filtros
El sistema SHALL ofrecer una vista "Insights" en el Toolbar, global a todas
las áreas, con filtro de área (todas/patagonia/datacef/personal) y selector
de período (30 días / 90 días / todo). El filtro aplica a tareas, eventos y
delegaciones; los imprevistos se muestran siempre (no tienen área).

#### Scenario: Filtrar por área
- **WHEN** se elige "datacef"
- **THEN** todas las métricas de tareas reflejan solo datacef
- **AND** el bloque de imprevistos sigue mostrando el total global

### Requirement: Resumen ejecutivo
La vista SHALL mostrar arriba tarjetas de resumen del período: tareas
completadas (y % hechas por el agente), cycle time promedio, imprevistos
surgidos, % resueltos el mismo día y plan-vs-real (planeadas completadas /
planeadas vivas).

#### Scenario: Lectura de un vistazo
- **WHEN** se abre la vista con período 30 días
- **THEN** las tarjetas muestran los seis números del período en una lectura
- **AND** cada tarjeta aclara su unidad (días, %, cantidades)

### Requirement: Throughput y tiempos
La vista SHALL mostrar completadas vs creadas por semana (barras), cycle
time (creada→completada, mediana en días) por área y por tipo de tarea, y
el tiempo promedio por estado desde la bitácora — esta última anotada
"solo tareas con bitácora" porque las tareas anteriores a `events` no
tienen camino, solo timestamps finales.

#### Scenario: Tarea vieja sin bitácora
- **WHEN** el rango incluye tareas creadas antes de la bitácora
- **THEN** el cycle time las cuenta (usa createdAt/completedAt)
- **AND** el tiempo por estado las excluye y muestra la nota

### Requirement: Distribución y ClickUp
La vista SHALL mostrar distribución del trabajo por área, tipo, executor y
proyecto de ClickUp (agrupando las sincronizadas por `clickupPath.listName`),
más el % de tareas de patagonia sincronizadas con ClickUp.

#### Scenario: Qué proyecto se come el tiempo
- **WHEN** hay tareas sincronizadas de varios proyectos
- **THEN** el gráfico de proyectos las agrupa por su list de ClickUp
- **AND** las tareas sin proyecto resuelto caen en "Sin proyecto"

### Requirement: Delegación al agente
La vista SHALL mostrar cuántas tareas resolvió cada executor (Cris/Claw/
ZCode), las horas delegadas (suma de duraciones de corridas terminadas), la
tasa de éxito del agente (corridas con estado hecho vs terminadas totales)
y la duración promedio por modelo.

### Requirement: Imprevistos ampliados
La vista SHALL extender las métricas de imprevistos: surgidos por día,
desglose por día de la semana, % resueltos el mismo día (incluyendo
promovidos cuya tarea se completó, como en el drawer), tendencia semanal y
la correlación entre imprevistos del día y % de planeadas completadas
(scatter + comparación días tranquilos ≤2 vs ruidosos ≥3).

### Requirement: Calidad del trabajo
La vista SHALL mostrar la tasa de reaperturas (eventos `reopened` sobre
tareas completadas), cumplimiento de dueDate (completadas a tiempo vs
vencidas) y el envejecimiento del backlog vivo (cuántas abiertas por rango
de edad: <7d, 7-30d, >30d).
