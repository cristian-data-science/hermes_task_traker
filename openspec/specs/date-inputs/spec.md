# Date Inputs Specification

## Purpose

Entrada de fechas en dos capas: el DatePicker (calendario visual para el
TaskModal) y el parser tolerante `parseTaskDates` (convierte texto libre en
fechas para la vista Calendario). El formato canónico que conecta ambas es
`yyyy-MM-dd`.

## Requirements

### Requirement: DatePicker con calendario
El sistema SHALL ofrecer en los campos de fecha del TaskModal (Fecha de
entrega, Standby desde, Pasa a pendiente el) un input de texto libre con
botón de calendario que despliega un mes navegable (‹ ›, locale es, semana
lunes→domingo), con "Hoy" resaltado, día seleccionado marcado, y acciones
"Hoy" y "Limpiar"; al elegir un día emite `yyyy-MM-dd`.

#### Scenario: Elegir fecha del calendario
- **WHEN** se abre el calendario y se clickea un día
- **THEN** el input queda con la fecha ISO y el popover se cierra

#### Scenario: Texto libre preservado
- **WHEN** el input contiene "mañana" y se guarda la tarea
- **THEN** el valor se persiste tal cual (el calendario no lo pisa)

### Requirement: Popover sin recorte
El sistema SHALL renderizar el calendario vía portal a `document.body` con
posicionamiento fixed y z-index sobre el modal, recolocándose al hacer
scroll/resize, cerrándose con Escape o clic fuera.

#### Scenario: Abrir calendario cerca del borde inferior
- **WHEN** no hay espacio debajo del input
- **THEN** el popover se coloca por encima del input

### Requirement: Parser tolerante en español
El sistema SHALL reconocer en `parseTaskDates` los formatos: ISO
(`2026-07-29` o con `/`), `dd-mmm-yyyy` con abreviatura española
(`08-jul-2026`), numérico `dd/mm/yyyy` o `dd-mm-yyyy`, y natural `"29 de
julio de 2026"` incluyendo listas (`"28, 29 y 30 de julio"`); año ausente →
año en curso; resultados deduplicados por día; variantes rioplatenses
(`setiembre`) aceptadas.

#### Scenario: Fechas programadas múltiples
- **WHEN** scheduledDates = "29 y 30 de julio 2026"
- **THEN** el calendario ubica la tarea en ambos días

#### Scenario: Formato irreconocible
- **WHEN** dueDate = "a la brevedad"
- **THEN** la tarea no aparece en ninguna celda y cae en "Sin fecha"
