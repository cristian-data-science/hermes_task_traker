# PRD: Iteración sin fricción con el agente (sin standby + estado iterando + ClickUp limpio)

| Campo | Valor |
|---|---|
| Fecha | 2026-09-23 |
| Dueño | Cristian |
| Módulo | agente (estados, panel, puente, ClickUp outbound) |
| Estado | hecho (máquina de estados verificada en dev con mutaciones reales) |

## 1. Problema

1. Al terminar una corrida, la tarea se iba sola a STANDBY: perdía su columna
   (en curso/urgente) y quedaba "enterrada".
2. En revisión solo se podía Aprobar (o dejarla): seguir iterando con el
   agente no era visible ni obvio.
3. El prompt que Cris le da al agente (task.notes) terminaba en la
   DESCRIPCIÓN de ClickUp: allá debe ir un resumen de lo hecho y qué falta.

## 2. Para quién

> **Cris**, que revisa resultados en En curso/Urgente y quiere ajustar por
> iteraciones antes de aprobar, sin que la tarea se mueva sola.

## 3. Solución

1. `para-revision` y `plan-para-aprobar` ya no mueven la columna (fuera del
   mapeo agentState→status; el badge informa).
2. Nuevo agentState `iterando` ("Iterando contigo", solo vista agente):
   entra cuando una continuación/feedback de trabajo es reclamada por el
   puente (claim) y durante la corrida (agentReport remapea trabajando);
   corre como en curso, igual que despachada/trabajando (decisión de Cris).
3. Panel de revisión: botón "Seguir iterando" junto a Aprobar (enfoca el
   bloque de continuación); el camino chat Ctrl+Enter ya encarga trabajo y
   ahora se ve como iteración.
4. ClickUp outbound: `mcpTaskArgs` NO manda task.notes para tareas de
   agente; la descripción pasa a ser el resumen de la última corrida
   ("Hecho: …" al completar / "Avance del agente: …" en revisión). El sync
   se dispara también al llegar a para-revision (antes no cambiaba columna
   y no se sincronizaba).

## 4. Casos de prueba (ejecutados en dev)

1. Corrida → para-revision: columna se QUEDA en en-curso (antes: standby). ✓
2. "Continuar con esta instrucción" → claim del puente → estado `iterando`
   ("Iterando contigo") con columna en-curso. ✓
3. Panel de revisión: "Seguir iterando" enfoca el textarea de continuación. ✓
4. Aprobar → Hecho · Completado. ✓
5. Guards: watchdog/orphans/redirect/chat-observador aceptan `iterando`. ✓

## 5. Criterios de aceptación

- [x] Build + tipos OK; `node --check` del puente OK; push a dev sin errores.
- [x] Verificado en navegador (badge, columna, panel) y por script (mutaciones).
