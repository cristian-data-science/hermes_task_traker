# Board Views Specification

## Purpose

Las tres vistas del tablero (Kanban, Lista, Calendario) y la capa común de
búsqueda y filtros. Comparten la misma fuente reactiva de tareas filtradas;
el Catch-up recibe deliberadamente la lista SIN filtrar.

## Requirements

### Requirement: Vista Kanban con drag & drop
El sistema SHALL mostrar las 6 columnas en orden fijo con tarjetas
arrastrables entre estados (@dnd-kit), resaltando la columna destino y
sincronizando el estado al soltar.

#### Scenario: Mover tarjeta entre columnas
- **WHEN** se arrastra una tarjeta de Pendiente a En curso
- **THEN** el estado persiste en backend y se registra el evento de
  bitácora correspondiente

### Requirement: Columnas ocultas
El sistema SHALL permitir ocultar columnas del Kanban (persistido en
localStorage `kanban-hidden-cols`). Las columnas ocultas no se renderizan
pero siguen siendo destinos válidos de drag (una tarea arrastrada ahí no se
pierde).

#### Scenario: Soltar sobre columna oculta
- **WHEN** un drag termina sobre una columna oculta
- **THEN** el cambio de estado se aplica igual y hay acción "mostrar todas"

### Requirement: Búsqueda y filtros
El sistema SHALL filtrar las tareas por texto libre (title + notes +
requestedBy), por área (chips, excluyendo áreas ocultas en settings) y por
estado (chips), combinables.

#### Scenario: Área oculta desaparece de los filtros
- **WHEN** se oculta el área datacef desde la configuración
- **THEN** su chip no aparece en la Toolbar y sus tareas no se listan (pero
  siguen sincronizándose con ClickUp)

### Requirement: Vista Lista
El sistema SHALL ofrecer una vista lista densa agrupada por área en orden
fijo, con grupos colapsables (header "N activas · N total"), orden
no-completadas-primero, acciones por fila (completar con undo, slider de
progreso) y botón de nueva tarea por área.

#### Scenario: Colapsar un área
- **WHEN** se colapsa el grupo de un área
- **THEN** solo queda su header con contadores y el estado persiste durante
  la sesión

### Requirement: Vista Calendario
El sistema SHALL mostrar una grilla mensual (semana lunes→domingo, locale
es, navegación de meses y botón Hoy) ubicando cada tarea en los días que
`parseTaskDates` reconozca de `dueDate`, `scheduledDates` y `standbyUntil`,
hasta 3 tareas por celda con "+N", y una sección "Sin fecha" para las no
reconocibles (excluyendo completadas).

#### Scenario: Tarea con fecha de entrega ISO
- **WHEN** una tarea tiene dueDate "2026-08-18"
- **THEN** aparece en la celda del 18 de agosto de 2026 y al clickearla se
  abre su edición

### Requirement: Agrupación por proyecto
El sistema SHALL ofrecer (toggle persistido `kanban-group-by-project`)
agrupar las tarjetas de cada columna por proyecto ClickUp: la clave del
grupo es el `listId` de la ruta resuelta (o por nombre para rutas viejas
sin id); el respaldo por `clickupListId` usa la MISMA clave; las lists con
nombre repetido en varios folders se prefijan con el folder; el subtítulo
de la tarjeta comprime los ancestros (primero › … › último).

#### Scenario: Tarea local sin destino
- **WHEN** una tarea no tiene clickupId ni clickupListId
- **THEN** cae en el grupo "Sueltas", que siempre va al final de la columna

#### Scenario: Grupo único de Mesa Técnica
- **WHEN** hay tareas de la list de Mesa Técnica con y sin ruta resuelta
- **THEN** todas caen en un único grupo etiquetado "Mesa Técnica" (nunca
  duplicado con el nombre real de la list)

#### Scenario: Ninguna tarea con proyecto resuelto
- **WHEN** se activa la agrupación y ninguna tarea tiene clickupPath
- **THEN** se muestra un aviso explicativo con botón "Resolver ahora"

### Requirement: Recalcular ubicaciones
El sistema SHALL ofrecer en el menú del tablero "Recalcular ubicaciones",
que relee de ClickUp la ubicación de TODAS las tareas sincronizadas
(refreshAll), además del modo incremental que solo completa faltantes.

#### Scenario: Tarea movida de list en ClickUp
- **WHEN** una tarea se movió de proyecto en ClickUp y se recalcula
- **THEN** su clickupPath se actualiza y el tablero la reagrupa
