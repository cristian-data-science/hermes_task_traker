# Catch-up Weekly Specification

## Purpose

Resumen semanal para la reunión con la jefatura. Nada se completa a mano
salvo los compromisos al cerrar: todo lo demás deriva del uso real del
tablero (bitácora de eventos). Orden de bloques = orden en que pregunta un
jefe. Solo área Patagonia.

## Requirements

### Requirement: Semanas con día de anclaje
El sistema SHALL organizar el resumen por semanas ancladas a un día
configurable (default martes, persistido), con navegación hacia atrás y
tope en la semana actual; la ventana se computa en hora local del cliente.

#### Scenario: Ver semana pasada
- **WHEN** se retrocede una semana
- **THEN** el resumen muestra los datos de esa ventana pasada

### Requirement: Bloques derivados
El sistema SHALL construir desde `catchups.getWeek`: métricas (completadas
con delta vs semana anterior, creadas, en curso, en cola, pendientes,
detenidas, cerradas-la-misma-semana), Done (completedAt en ventana),
Advanced (progreso de sub-tareas de TODAS las abiertas), En curso, En cola
(urgentes, aviso a los 7 días), Pendientes (aviso 30 días), Detenido
(standby+programado, aviso 14 días), Reabiertas, Incoming (creadas en la
ventana, con flags fromClickup y closedSameWeek) y Temas para conversar
(tareas con catchupFlag + nota).

#### Scenario: Tarea urgente estancada
- **WHEN** una urgente lleva 8 días sin cerrarse
- **THEN** el bloque En cola la marca con aviso de antigüedad

### Requirement: Pin "llevar al catch-up"
El sistema SHALL permitir pinear tareas durante la semana (botón en la
tarjeta + nota corta opcional); el pin es una anotación privada que NUNCA
viaja a ClickUp y se limpia automáticamente al cerrar la semana.

#### Scenario: Pinear y cerrar semana
- **WHEN** se cierra la semana con temas pineados
- **THEN** quedaron en el snapshot y los flags se limpian para la próxima

### Requirement: Compromisos con linaje
El sistema SHALL manejar compromisos con linaje estable: al cerrar, los no
cumplidos de la semana anterior se arrastran solos con `carryCount+1` y
`rootId` estable a través de reformulaciones; se pueden vincular a tareas
abiertas; los "gone" (sin tarea) no se arrastran. Marcado de cumplidos de
la semana anterior ("Venís de…") con `setCommitmentDone`.

#### Scenario: Compromiso incumplido re-formulado
- **WHEN** un compromiso se arrastra 3 semanas con textos distintos
- **THEN** la cadena (HistoryDrawer › Cadena) lo muestra como una sola
  promesa de 3 semanas

### Requirement: Cierre congelado
El sistema SHALL congelar al cerrar: snapshot + notas libres + borradores
de compromisos; la semana cerrada muestra el snapshot por defecto con
banner y toggle "Ver cómo está hoy" / "Ver lo que presenté"; se puede
reabrir.

#### Scenario: Semana cerrada cambia después
- **WHEN** se mueven tareas de una semana ya cerrada
- **THEN** el snapshot presentado no cambia (el toggle permite ver hoy)

### Requirement: Historia y copia
El sistema SHALL ofrecer un drawer de historia con 3 pestañas: Semanas
(semanas cerradas re-renderizadas), Cadena (promesas rankeadas por
semanas-consecutivas-prometidas) y Tendencia (12 semanas); y copiar el
resumen como texto plano con marcas [OK]/[~]/[!]/[-], respetando el toggle
congelado/hoy.

#### Scenario: Copiar resumen para el chat
- **WHEN** se pulsa copiar
- **THEN** el texto plano de la vista activa queda en el portapapeles
