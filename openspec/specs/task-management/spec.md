# Task Management Specification

## Purpose

CRUD del modelo central de la app: tareas con área, estado, ejecutor y campos
opcionales de planificación. Toda mutación pasa por el backend Convex con
sesión válida, sanea los textos y registra eventos en la bitácora que luego
alimenta el Catch-up semanal.

## Requirements

### Requirement: Modelo de tarea
El sistema SHALL persistir tareas con: `title` (obligatorio), `area`
(`patagonia` | `datacef` | `personal`), `status` (6 estados), `executor`
(`cris` humano | `claw` agente), `notes`, `estimate`, `dueDate`,
`progress` (0–100), `standbyFrom`, `standbyUntil`, `scheduledDates`,
`requestedBy`, `order` (posición en columna), `completedAt`, `deletedAt`
(soft-delete) y timestamps. Los campos de texto libre tienen límite de
longitud validado server-side.

#### Scenario: Crear tarea mínima
- **WHEN** se crea una tarea solo con título y área
- **THEN** se persiste con los opcionales ausentes y se agenda el evento
  `created` en la bitácora

#### Scenario: Progreso fuera de rango
- **WHEN** el cliente envía `progress` fuera de 0–100
- **THEN** el backend lo acota (clamp) antes de persistir

### Requirement: Estados
El sistema SHALL soportar exactamente 6 estados: `urgente`, `pendiente`,
`en-curso`, `standby`, `programado`, `completado`. Las columnas del Kanban
siguen el orden fijo de `KANBAN_COLUMNS`: urgente, en-curso, pendiente,
programado, completado, standby.

#### Scenario: Cambio de estado desde el modal
- **WHEN** se edita una tarea cambiando su estado desde el TaskModal
- **THEN** la tarea se mueve al tope (order 0) de la nueva columna y se
  registra el cambio en la bitácora

### Requirement: Completado con progreso automático
El sistema SHALL marcar `completedAt` al pasar a `completado` y fijar
`progress` en 100 salvo que el patch traiga un progreso explícito. Reabrir
( salir de `completado`) es un evento `reopened` visible en el Catch-up.

#### Scenario: Completar sin tocar progreso
- **WHEN** una tarea en curso con progress 40 pasa a completado
- **THEN** `progress` queda en 100 y `completedAt` se setea

### Requirement: Campos opcionales vaciables
El sistema SHALL distinguir "campo ausente" (no tocar) de "string vacío"
(vaciar el campo) en updates: fechas, estimación, standby, notas y
solicitado por se limpian cuando llega `""`.

#### Scenario: Limpiar una fecha al editar
- **WHEN** el DatePicker emite `""` para dueDate y se guarda
- **THEN** el campo desaparece del documento (undefined), no queda ""

### Requirement: Soft-delete
El sistema SHALL marcar `deletedAt` en vez de borrar físicamente; todas las
queries activas filtran por `deletedAt === undefined`. Borrar una tarea
patagonia sincronizada (no desvinculada) también la borra en ClickUp.

#### Scenario: Eliminar tarea local
- **WHEN** se elimina una tarea de área personal
- **THEN** queda marcada deletedAt y desaparece del tablero sin llamadas a
  ClickUp

### Requirement: Ordenamiento por arrastre
El sistema SHALL persistir el `order` de las tareas de una columna al
soltar un drag; el estado optimista solo vive durante el arrastre y las
columnas se derivan del servidor fuera de él.

#### Scenario: Arrastrar dentro de una columna
- **WHEN** se suelta una tarjeta en una nueva posición de su columna
- **THEN** los `order` afectados se renumeran y persisten en backend

### Requirement: Creación por defecto contextual
El sistema SHALL abrir el TaskModal en modo creación con `defaultStatus` y
`defaultArea` derivados del contexto (columna o área desde donde se pulsó
"+"), y conservar el borrador ante reaperturas del mismo contexto.

#### Scenario: Reabrir el modal tras un misclic
- **WHEN** se cierra el modal sin guardar y se reabre la misma tarea/acción
- **THEN** el borrador escrito sigue intacto
