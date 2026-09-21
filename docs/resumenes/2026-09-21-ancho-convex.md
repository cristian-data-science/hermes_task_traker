# Resumen post-implementación: ancho de banda Convex sin perder reactividad

PRD: `docs/prds/cristian/agente/2026-09-21-ancho-convex.md` · 2026-09-21

## 1. Qué se implementó

- El tailer de ZCode ya no reenvía la misma línea de actividad a Convex cada
  5 s: solo reporta cuando la actividad CAMBIÓ (antes parcheaba la corrida
  cada tick aunque el texto no cambiara, y cada parche re-enviaba
  `runsByTask` e `insights.dataset` a todos los clientes suscritos).
- Dedup equivalente en el adaptador de Claude (sin `activity` idéntica
  consecutiva).
- `agent:runsByTask` devuelve una proyección con solo los campos que consumen
  el panel del tablero y el tracker del chat (fuera: `promptDigest`,
  `autonomy`, `exitCode`, `activityCount`, `updatedAt`).
- `agent:redirectQueue` lee por índice nuevo `by_agent_redirect` en vez de
  `collect()` de toda la tabla (suscripción 24/7 del puente).
- `agent:agentOverview` lee por índice `by_agent_state` (solo tareas con
  estado de agente) en vez de `collect()` completo; mismo resultado y orden.

## 2. Cómo se implementó

- `agent-bridge/agents/zcode.mjs`: `lastSent` en el tailer; el timestamp
  local de vida (`run.lastActivityAt`, detector de atascos) se sigue
  refrescando en cada tick igual que antes — la semántica de atascos no
  cambia.
- `agent-bridge/agents/claude.mjs`: guard `run._lastSentActivity`.
- `convex/schema.ts`: índice `by_agent_redirect` (las filas sin el campo
  quedan fuera del índice — la suscripción del puente pasa de leer TODA la
  tabla a leer solo las tareas con redirección pendiente).
- `convex/agent.ts`: proyección en `runsByTask`; reescritura de
  `redirectQueue` y `agentOverview` con `withIndex` y orden final por
  `createdAt` (idéntico al escaneo completo).
- `src/components/AgentRunsPanel.tsx`: tipo `RunView` =
  `FunctionReturnType<typeof api.agent.runsByTask>[number]` en vez de
  `Doc<"agentRuns">` (2 anotaciones).

## 3. Por qué es la mejor forma

- Cero cambio funcional por diseño: no se elimina ninguna suscripción ni se
  baja ninguna cadencia de reporte; solo se deja de enviar información
  idéntica a la ya enviada, y se dejan de leer documentos que la query
  descartaba. Frescura y reactividad quedan intactas.
- Alternativas descartadas: recortar `tasks:list` (el peso es contenido real
  de la UI: `notes` 17 KB de 62 KB medidos), paginar o des-suscribir vistas
  (rompería la reactividad que Cris exige), bajar `TAIL_MS` (menos frescura).

## 4. Qué probar para confiar en el cambio

1. Delega una tarea y abre el chat del agente: el tracker sigue mostrando
   cada paso nuevo EN VIVO (ahora cada envío corresponde a un cambio real).
2. Con la corrida activa, abre Insights: el dashboard de Convex ya no
   registra escrituras de `runActivity` cada 5 s cuando el agente está
   callado — solo con novedades reales.
3. Prueba una redirección en vivo: sigue llegando al instante (índice nuevo).
4. Panel de delegación: checklist, última actividad, propuesta de reporte,
   fases y botones — todo se renderiza igual.
5. En el dashboard de Convex → Usage: la curva de bandwidth debe aplanarse
   en corridas largas (antes: escalón cada 5 s).

## 5. Efectos secundarios y deudas

- Único matiz visible: durante un tramo callado de una corrida, el "hace X"
  de última actividad en el panel ahora envejece de verdad (antes se
   refrescaba cada 5 s con el mismo texto). Muestra información más honesta.
- `insights.dataset` sigue siendo un full scan (76 KB medidos) pero solo se
  suscribe con la vista abierta y su churn cae con el fix del tailer. Si
  algún mes vuelve a apretar, la siguiente palanca es pre-agregar en el
  backend (el propio archivo lo anticipa).
- Tras el merge: desplegar funciones a producción (`npx convex deploy`) — el
  índice nuevo se construye solo. El cambio del puente aplica al reiniciar
  el daemon local.
