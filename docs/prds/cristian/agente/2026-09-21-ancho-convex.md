# PRD: Ancho de banda Convex — matar el churn sin perder reactividad

| Campo | Valor |
|---|---|
| Fecha | 2026-09-21 |
| Dueño | Cristian |
| Módulo | agente (puente + Convex) |
| Estado | hecho (equivalencia A/B verificada en dev) |
| Relacionados | diagnósitco previo en la conversación de origen |

## 1. Problema

El plan gratuito de Convex (1 GB/mes de ancho de banda) saltó en septiembre
(agosto: <200 MB). La base es chica (132 tareas, 220 eventos, 26 corridas):
no es volumen de datos, es **amplificación reactiva** — suscripciones que se
re-envían completas con cada escritura, multiplicadas por escrituras
automáticas innecesarias y por la cantidad de clientes conectados.

Medido en producción (2026-09-21, `agent-bridge/diag-ancho.mjs`, script
temporal): `tasks:list` 62 KB por envío, `insights:dataset` 56–76 KB,
`agentOverview` 17 KB.

**La mecha**: el tailer de ZCode reenvía la MISMA línea de actividad a
`runActivity` cada 5 s (`TAIL_MS`) aunque el texto no cambió — cada envío
parchea la corrida, y cada parche re-envía `runsByTask` + `insights.dataset`
(76 KB) a todos los suscritos. Una corrida de 2 h con Insights abierto quema
cientos de MB.

## 2. Para quién

> **Cris**, que necesita que la app siga 100 % reactiva (datos frescos en
> tablero, vista Agente, panel de corridas, chat, insights) sin regalar ancho
> de banda en escrituras que no aportan información.

## 3. Solución (sin ningún cambio funcional)

Requisito duro: mismas suscripciones, mismos datos en pantalla, misma
frescura. Solo se elimina trabajo que no aporta información nueva:

1. **Tailer ZCode** (`agent-bridge/agents/zcode.mjs`): reportar actividad a
   Convex SOLO cuando la línea descrita cambió. El timestamp local de vida
   (`run.lastActivityAt`, que alimenta el detector de atascos) se sigue
   refrescando en cada tick igual que hoy.
2. **Mismo dedup en Claude** (`agents/claude.mjs`): no reenviar `activity`
   idéntica consecutiva.
3. **`agent:runsByTask`** (`convex/agent.ts`): proyección con SOLO los campos
   que consumen el panel del tablero y el tracker del chat. Fuera:
   `promptDigest`, `autonomy`, `exitCode`, `activityCount`, `updatedAt`
   (nadie los lee — verificado por grep + `tsc`).
4. **`agent:redirectQueue`**: índice nuevo `by_agent_redirect` en `tasks` —
   antes era `collect()` de TODA la tabla en una suscripción 24/7 del puente.
5. **`agent:agentOverview`**: lectura por índice `by_agent_state` (solo
   tareas con estado de agente) en vez de `collect()` completo; el resultado
   y su orden (por `createdAt`) son idénticos.

No se toca: `tasks:list` (el peso es contenido real de la UI), 
`insights:dataset` (solo se suscribe con la vista abierta; su churn cae por
sí solo con el fix 1), cadencias de reporte ni ninguna suscripción.

## 4. Casos de prueba

1. Corrida activa con el chat abierto → el tracker sigue mostrando cada paso
   nuevo EN VIVO (los envíos ahora corresponden a cambios reales).
2. Corrida activa con Insights abierto → `dataset` solo se re-envía cuando
   hay novedades reales (no cada 5 s).
3. `runsByTask` antes/después → mismos runs, mismos campos usados, orden
   idéntico (A/B contra deployment dev).
4. `agentOverview` antes/después → deep-equal del resultado (A/B dev).
5. Redirección en vivo → sigue llegando al instante (índice nuevo).
6. Panel de corridas → checklist, última actividad, propuesta, reporte y
   fases se renderizan igual (mismos campos en la proyección).
7. `npm run build` sin errores de tipos (verifica que ningún consumidor
   use un campo excluido).

## 5. Criterios de aceptación

- A/B de equivalencia en dev: `agentOverview` y `runsByTask` idénticos.
- Build y typecheck limpios; E2E básico del tablero sin regresiones.
- En una corrida quieta (sin salida nueva) el dashboard de Convex no muestra
  escrituras de `runActivity` cada 5 s.
