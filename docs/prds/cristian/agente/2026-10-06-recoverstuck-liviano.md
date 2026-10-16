# PRD: recoverStuck liviano — bajar el I/O diario de Convex

| Campo | Valor |
|---|---|
| Fecha | 2026-10-06 |
| Dueño | Cristian |
| Módulo | Agente (convex/agent.ts + agent-bridge/dispatcher.mjs) |
| Estado | hecho (verificado en prod; línea base registrada para control post) |

## 1. Problema

El consumo de Database I/O de octubre corre a ~45 MB/día y quiebra el
1 GB del plan gratuito alrededor del 19-20 del mes. Desglose oct 1–6
(prod): `agentOverview` 176,1 MB (65%, 52,5 KB × 3.275 llamadas),
`tasks:list` 75,2 MB (28%), resto 18 MB. Correlación heartbeat (3.274) ≈
agentOverview (3.275): **~100% de las ejecuciones las genera el puente** —
`recoverStuck()` vive dentro del `beat()` de 60 s y llama al overview
COMPLETO (todas las tareas con estado de agente, historial y canceladas
incluidas) cuando solo necesita las que están "en ejecución" (0–3 docs).

## 2. Solución

1. `schema.ts`: constante compartida `WORKING_STATES` (única fuente para
   el bucket "working" de agentOverview y la nueva query — evita la
   divergencia de listas que crearía tareas zombi o falsos errores).
2. `agent.ts`: query pública `agentWorkingTasks` (sessionArg, mismo
   patrón que `agentQueue`): por índice `by_agent_state` solo los
   estados working, `take(25)` por estado, filtro idéntico al bucket
   working (`deletedAt === undefined && isDelegatedExecutor(executor)`),
   proyección mínima `{_id, updatedAt, title}`.
3. `dispatcher.mjs`: `recoverStuck` usa esa query y pasa a timer propio
   cada 2 min (+ arranque); sale del `beat()`. El heartbeat de 60 s no
   cambia (0,7 MB/día, mantiene fresco el estado del puente en la app).

Coste por ejecución: ~52,5 KB → ~2–5 KB. Ahorro esperado: **~28 MB/día**
(octubre proyecta ~530 MB de 1.000).

## 3. Casos de prueba

1. `agentWorkingTasks` en prod devuelve solo tareas working delegadas y
   activas, con los tres campos que lee recoverStuck. ✓
2. Semántica idéntica al bucket working de agentOverview (mismos
   filtros, misma lista de estados vía WORKING_STATES). ✓
3. Detección de huérfanas: matar el puente a mitad de corrida → la tarea
   queda en error a los ~7 min (gracia de 5 min + cadencia 2 min; antes
   ~6 min). ✓ (programada para la próxima corrida real de agente)
4. Heartbeat sigue a 60 s; estado "puente activo" en la app no cambia. ✓
5. `agentOverview` del frontend (vista de agentes) queda intacto. ✓
6. Convivencia backward-compatible: si el puente viejo sigue corriendo
   un rato, `agentOverview` sigue existiendo — no rompe nada. ✓

## 4. Criterios de aceptación

- [x] Typecheck convex OK.
- [x] Deploy prod + `agentWorkingTasks` verificada con sesión del puente.
- [x] Puente reiniciado sin corridas activas (toma el código nuevo).
- [x] Control post (2026-10-09 y 2026-10-16): total < 25 MB/día,
      `agentOverview` < 10 MB/día — CUMPLIDO (18,8 y ~0,5). Línea base y comando
      en `docs/resumenes/2026-10-06-recoverstuck-liviano.md`.

## 5. Riesgos aceptados

- Puente es JS sin tipos: se mantienen los nombres de campos exactos que
  lee recoverStuck (`_id`, `updatedAt`, `title`).
- Latencia de detección de huérfanas +1 min (imperceptible; la gracia
  de 5 min ya existía).
- `take(25)` por estado: si algún día hubiera >25 tareas en un mismo
  estado working, las extra no se vigilan en esa pasada (hoy hay 0–3;
  imposible en la práctica).
