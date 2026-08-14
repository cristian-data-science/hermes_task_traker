# Subtasks Specification

## Purpose

Sub-tareas con checkbox dentro de una tarea, reordenables por drag. Viven
solo en edición (requieren tarea existente) y alimentan los contadores
agregados de las tarjetas y filas.

## Requirements

### Requirement: CRUD de sub-tareas
El sistema SHALL permitir crear (input + Enter en el TaskModal), marcar
hechas (toggle con `completedAt`) y eliminar sub-tareas de una tarea, todas
operaciones protegidas por sesión.

#### Scenario: Marcar sub-tarea hecha
- **WHEN** se tilda el checkbox de una sub-tarea
- **THEN** se persiste done + completedAt y el contador done/total de la
  tarjeta se actualiza

### Requirement: Reordenamiento por arrastre
El sistema SHALL reordenar sub-tareas con @dnd-kit (sensor pointer con
activación por distancia para no pisar el click del checkbox/eliminar) y
persistir el nuevo índice.

#### Scenario: Arrastrar sub-tarea al tope
- **WHEN** se suelta una sub-tarea en la primera posición
- **THEN** su `order` persiste como 0 y las demás se desplazan

### Requirement: Contadores agregados
El sistema SHALL exponer una única query agregada (`subtasks.allCounts`)
que devuelve `Record<taskId, {done, total}>` para evitar N requests por
tarjeta; ante fallo o falta de sesión devuelve vacío.

#### Scenario: Cargar el tablero
- **WHEN** se renderiza el Kanban con 50 tareas
- **THEN** los contadores de sub-tareas llegan en una sola query

### Requirement: Sin ruido en la bitácora
El sistema NO SHALL registrar un evento por sub-tarea al completar la tarea
madre: cerrar la madre ya cuenta la historia.

#### Scenario: Completar tarea con 8 sub-tareas
- **WHEN** la madre pasa a completado
- **THEN** la bitácora registra solo el evento de la madre
