# ClickUp Inbound Sync Specification

## Purpose

Dirección ClickUp → Hermes: suscripciones persistentes a nodos del
workspace, importación idempotente, bandeja de tareas asignadas sin
trackear y mapeo bidireccional de estados. Desde que el workspace Patagonia
bloqueó el personal API token, TODAS las lecturas (árbol del workspace,
tareas por list con padres explícitos, tareas asignadas, detalle) salen
por el canal MCP/OAuth compartido con el outbound.

## Requirements

### Requirement: Lecturas vía MCP
El sistema SHALL realizar todas las lecturas de ClickUp por tools MCP:
`clickup_get_workspace_hierarchy` (árbol paginado del space para picker y
página de sync), `clickup_filter_tasks` (raíces por list; tareas asignadas
a Cristian), `clickup_get_task` con `include:["subtasks"]` (expansión de
hijos con parent estampado por construcción), normalizadas al shape legacy
que consumen los flujos existentes.

#### Scenario: Abrir el modal de tarea con el picker
- **WHEN** se carga la jerarquía para anclar una tarea en un subproyecto
- **THEN** los folders/lists provienen del árbol MCP y no hay 401 del
  personal token

#### Scenario: Bandeja con tareas asignadas
- **WHEN** se consulta "asignadas a mí sin trackear"
- **THEN** las candidatas provienen de filter_tasks(assignees=yo) y se
  resuelven contenedor vs hoja con la expansión jerárquica por list

### Requirement: Mapeo de estados
El sistema SHALL mapear estados Hermes↔ClickUp en ambos sentidos
(`mapStatusToClickUp` / `mapStatusFromClickUp`) de forma consistente para
que un ciclo ida-vuelta no degrade la información.

#### Scenario: Tarea urgente sincronizada
- **WHEN** una tarea Hermes urgente se publica
- **THEN** su status ClickUp es el mapeado y al reimportar sugiere urgente

### Requirement: Suscripciones
El sistema SHALL permitir suscribirse (checkboxes tri-estado en la página
de exploración del workspace) a folders, lists y tareas individuales,
persistidas en `clickup.subscriptions` (JSON, dedup por id, corrupto lanza
en vez de wipear). Aplicar importa inmediatamente las actuales y mantiene
actualizadas las futuras por nodo; los proyectos y Mesa Técnica tienen
flag `inbound` propio en la config.

#### Scenario: Suscribirse a un folder
- **WHEN** se marca un proyecto y se aplica
- **THEN** sus tareas actuales se importan y la suscripción persiste

#### Scenario: JSON de suscripciones corrupto
- **WHEN** el valor guardado no parsea
- **THEN** la mutation falla explícitamente en vez de borrar las
  suscripciones existentes

### Requirement: Importación idempotente
El sistema SHALL deduplicar la importación por `clickupId` (índice
`by_clickup_id`): si ya existe activa no hace nada; si está soft-deleted u
  ignorada, la restaura en vez de duplicar. Preserva responsable original
(`clickupAssignee`, executor=cris solo si está asignada a Cristian) y
convierte `time_estimate` ms → texto legible ("1.5h").

#### Scenario: Reimportar la misma tarea
- **WHEN** la tarea de ClickUp ya existe en Hermes
- **THEN** no se crea duplicado y devuelve el id existente

### Requirement: Tarea importada con ubicación
El sistema SHALL crear tareas importadas con `clickupPath` (folder/list con
ids y nombres) obtenido de la misma respuesta del escaneo, sin llamadas
extra, para que agrupen por proyecto desde el alta.

#### Scenario: Importar tarea de un folder suscripto
- **WHEN** entra una tarea del folder Ley de Datos
- **THEN** nace con clickupPath.listId/listName y agrupa en su proyecto

### Requirement: Bandeja de asignadas sin trackear
El sistema SHALL ofrecer la bandeja ("Asignadas a mí en ClickUp sin
trackear"): tareas HOJA asignadas a Cristian en el workspace que no están
en el tablero, agrupadas por folder/list con contadores, con importación y
undo inmediato (`undoAssignedAdd`).

#### Scenario: Me asignan una tarea nueva
- **WHEN** aparece una tarea asignada no trackeada
- **THEN** la bandeja la lista en su ubicación y puedo importarla

#### Scenario: Importar por error
- **WHEN** se importa desde la bandeja y se pulsa deshacer
- **THEN** la tarea se retira del tablero y vuelve a la bandeja
