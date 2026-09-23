# Resumen post-implementación: chat menos invasivo (razonamiento y herramientas sutiles)

PRD: `docs/prds/cristian/agente/2026-09-23-chat-render-sutil.md` · 2026-09-23

## 1. Qué se implementó

- El razonamiento del agente ya no abre una caja grande: es una línea
  callada "Razonando…/Razonó · 5 s · 513 caracteres", cerrada por defecto
  (también en vivo), expandible con clic.
- Las herramientas pasaron de tarjetas apiladas de ancho completo a chips
  compactos en nube; la activa lleva acento, las completas quedan atenuadas
  y la salida se despliega bajo el chip al hacer clic.
- Verificación pedida: el bug de la respuesta final perdida NO afecta a
  ZCode — su handler usa ids con assistantMessageId + toolCallId explícito
  (sin índices reutilizables); era exclusivo del traductor de Claude.

## 2. Cómo se implementó

- `zchat-ui/app.js` (`makeThink`): `open: false` — cerrado por defecto en
  vivo e historial; abrirlo queda a elección del lector (el "pinned" ya
  existía para no autocerrar).
- `zchat-ui/app.css`: `.think` sin borde/fondo (línea tipográfica); cuerpo
  abierto como cita con regla izquierda punteada. `.tools` pasa a fila con
  wrap; `.tool` a pill (radius 999, 11px mono, fondo 4%, acento solo en
  running, error con tinte rojo); `.sum` acotado a 32ch con elipsis.

## 3. Por qué es la mejor forma

- Progressive disclosure: lo procesal (razonar, ejecutar) ocupa una línea
  hasta que el lector pida más; la respuesta es lo que domina el turno.
- Sin cambios de protocolo ni del servidor: puro CSS + default del
  details; el historial hereda la misma vista (comparte los makers).

## 4. Qué probar

1. Abre el chat de una tarea con historia: razonamientos = líneas,
   herramientas = chips, respuesta protagonista.
2. En vivo: pregunta algo que requiera leer un archivo; observa la línea
   "Razonando…" pulsar y los chips aparecer sin empujar el contenido.
3. Clic en "Razonó" y en un chip con salida → expanden; re-clic cierra.
4. Sin gastar tokens: `ZCHAT_DEMO=1 node agent-bridge/zchat-server.mjs
   <sesión> <carpeta> ... zcode` reproduce un turno completo.

## 5. Efectos secundarios y deudas

- Hallazgo relacionado (preexistente): el spawn de ZCode del chat no pasa
  `--model` (la rama Claude sí pasa el de la tarea); en chats sin tracker
  el CLI puede pedir modelo ("Select a model before continuing"). Pendiente
  como seguimiento: pasar tracker.task?.model también a ZCode.
- La verificación en vivo se hizo con el modo demo (sin consumo); la
  equivalencia con turnos reales ZCode queda por confirmar cuando el CLI
  tenga modelo default (ver deuda anterior).
