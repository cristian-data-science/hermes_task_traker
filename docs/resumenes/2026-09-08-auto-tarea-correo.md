# Resumen: correo nuevo → tarea automática "pendiente" (2026-09-08)

PRD: `docs/prds/cristian/correos/2026-09-08-auto-tarea-pendiente.md`
(base: ingesta de correos del 2026-08-31).

## Qué

Cada correo que entra por el webhook de Power Automate (`POST /correos/ingesta`)
genera automáticamente, en la misma transacción, una tarea en el tablero:

- Área **patagonia**, estado **pendiente**, arriba de la columna.
- Título = asunto (fallback "(correo sin asunto)"); `requestedBy` = remitente.
- Notas = De / Recibido / "Abrir en Outlook" + cuerpo (≤5000 chars; el cuerpo
  completo queda en la tabla `correos`).
- Se agenda el sync de ClickUp → nace publicada en **Mesa Técnica**.
- El correo queda **procesado** con su `tareaId` (la cola no acumula).

Además, `internalMutation procesarUltimo` permite crearle la tarea al correo
"nuevo" más reciente a mano (`npx convex run [--prod] correos:procesarUltimo`).

## Cómo

- `convex/correos.ts`: helper `crearTareaDeCorreo` (patrón de `tasks.create`:
  shift +1 de la columna + insert order 0 + `logEvent created`) enganchado al
  final del insert de `ingestar`. El redisparo del webhook (patch de
  contenido) no vuelve a crear la tarea: la idempotencia por `messageId` ya
  lo impedía.
- Sin cambios de schema ni crons: el flujo sigue 100% evento-driven.
- El `sessionToken:""` del sync agendado es intencional (`syncTask` no
  re-valida; la ingesta no tiene sesión).

## Por qué

La cola `pendientes` nació para un triage que todavía no existe; mientras
tanto, todo correo marcado por Cris es algo que hacer. La tarea "pendiente"
es el mínimo que deja el recuerdo accionable en el tablero (y en ClickUp) sin
inventar categorización automática.

## Pruebas

- dev: POST nuevo → `{creado:true, tareaId}`; redisparo → `{creado:false}`
  sin tarea nueva; `procesarUltimo` consumió el correo viejo de prueba del
  31-08 que había quedado "nuevo".
- prod: `npx convex run --prod correos:procesarUltimo` → tarea creada para el
  último correo existente (`k179e1h2aqcmcdftrs907yxjrs8e01q0`), sync a Mesa
  Técnica agendado.
- En dev el ClickUp sync sigue bloqueado salvo `forceSyncDev` (guard
  existente): las pruebas no tocaron el workspace real.

## Deuda / siguientes

- La tarea nace sin `scheduledDates`: no aparece en el calendario hasta
  ponerle fechas a mano (decisión del PRD).
- Panel de triage de correos sigue pendiente (fase siguiente del PRD base);
  `pendientes`/`marcarProcesado` siguen disponibles para ese futuro.
- Test rows en dev (`<test-auto-tarea@hermes.local>` y las del 31-08) quedaron
  con sus tareas de prueba; limpiar con `correos:eliminar` cuando estorben.
