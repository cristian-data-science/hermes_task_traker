# Resumen post-implementación: iteración sin fricción con el agente

PRD: `docs/prds/cristian/agente/2026-09-23-iterar-sin-friccion.md` · 2026-09-23

## 1. Qué se implementó

- La tarea ya NO se va a standby al quedar para revisión (ni con plan por
  aprobar): se queda en su columna; el badge del agente informa.
- Nuevo estado de agente `iterando` ("Iterando contigo", solo vista agente;
  columna en curso igual que trabajando — decisión de Cris): visible desde
  que el puente reclama una continuación/feedback hasta que la corrida
  vuelve a quedar en revisión.
- Panel de revisión: "Seguir iterando" junto a "Aprobar" (enfoca el bloque
  de continuación) + texto que explica que iterar no cierra la tarea.
- ClickUp: el prompt de Cris (task.notes) ya no viaja a la descripción de
  tareas de agente; la descripción pasa a llevar el resumen de la última
  corrida ("Hecho: …" / "Avance del agente: …"). El sync se dispara también
  al entrar en para-revision.

## 2. Cómo se implementó

- `convex/schema.ts`: `iterando` en la unión de agentState (tareas y corridas).
- `convex/agent.ts`: mapeo sin standby para revisión/plan; `iterando: en-curso`;
  claimTask marca iterando cuando el followUp es continuación/feedback;
  agentReport remapea trabajando→iterando por kind de la corrida; gates
  (reportAllowed, redirects, overview, huérfanas) aceptan iterando; trigger
  del sync de ClickUp al entrar en para-revision sin cambio de columna.
- `convex/clickup.ts`: `mcpTaskArgs(task, agentSummary)` — sin notes para
  agentes; descripción = resumen de `_latestRunWithSummary`.
- `agent-bridge/`: dispatcher (corrida viva incluye iterando; fix de
  `summary: null` del watchdog que la validación de Convex rechazaba),
  report.mjs (corrida abierta incluye iterando), zchat-server (observador).
- `src/`: badge/meta `iterando` (constants), listas de estados en
  AgentView/AgentRunsPanel/TaskCard, botón "Seguir iterando" (AgentRunsPanel).

## 3. Por qué es la mejor forma

- El mapeo de estados sigue siendo LA única fuente (un solo lugar cambia la
  columna); iterando reusa el camino de trabajando en todos los guards en
  vez de bifurcar el flujo.
- ClickUp: el resumen ya existía como comentario al completar; ahora también
  como descripción (Hecho/Avance) y el prompt nunca sale del tracker.

## 4. Qué probar

1. Tarea delegada corriendo en En curso → al terminar queda "Para revisión"
   EN EN CURSO (no standby).
2. Panel → "Seguir iterando" → escribe el ajuste → "Continuar con esta
   instrucción" → badge "Iterando contigo" (columna en curso) → al terminar
   vuelve a "Para revisión" en la misma columna.
3. Chat: Ctrl+Enter encarga trabajo → mismo ciclo.
4. ClickUp: la tarea de agente nueva nace con descripción limpia; al quedar
   en revisión/completarse su descripción muestra el resumen del agente.

## 5. Efectos secundarios y deudas

- Verificado en dev conduciendo las mutaciones reales (sin gastar modelos:
  ni Claude ni GLM tienen saldo hoy; el flujo completo con corrida real
  queda para cuando haya recarga).
- El comentario de ClickUp al completar sigue existiendo (además de la
  descripción): son complementarios.
- Tareas YA en standby por corridas viejas no se recolocan solas: moverlas
  a mano una vez.
