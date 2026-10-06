# Resumen post-implementación: recoverStuck liviano (I/O de Convex)

PRD: `docs/prds/cristian/agente/2026-10-06-recoverstuck-liviano.md` · 2026-10-06
(directo en master a pedido de Cris)

## 1. Qué se implementó

- Nueva query pública `agentWorkingTasks`: solo estados "working" por
  índice, `take(25)` por estado, mismos filtros del bucket working de
  agentOverview, proyección `{_id, updatedAt, title}`.
- Constante compartida `WORKING_STATES` en `schema.ts`: única fuente para
  el bucket working de `agentOverview` y la nueva query.
- `dispatcher.mjs`: `recoverStuck` usa la query liviana y pasó de vivir
  dentro del `beat()` de 60 s a timer propio cada 2 min (+ arranque).
  Heartbeat de 60 s intacto (estado del puente fresco en la app).

## 2. Línea base para el control post (REGISTRADA 2026-10-06)

Ventana oct 1–6, deployment prod (effervescent-crab-895):

| Concepto | Valor |
|---|---|
| Database I/O total | 272,3 MB en 6 días (**~45 MB/día**) |
| `agentOverview` | 176,1 MB · 3.275 llamadas · 52,5 KB/call (65,4%) |
| `tasks:list` | 75,2 MB · 593 llamadas · 123,8 KB/call (27,9%) |
| Resto | ~18 MB (subtasks 8, heartbeat 4, sync…) |
| Correlación heartbeat↔agentOverview | 3.274 ≈ 3.275 (puente = ~100%) |

**Metas al revisar en unos días (ventana 2026-10-06 → fecha del check):**
- Database I/O total: **< 25 MB/día** (antes 45).
- `agentOverview`: **< 10 MB/día** (antes 29,4).
- `agentWorkingTasks`: aparece en el desglose con ~720 llamadas/día a
  ~2–5 KB/call (≈ 2–4 MB/día) — ese es el nuevo piso esperado.
- Proyección de octubre: < 700 MB de 1.000 MB incluidos.

**Comando de verificación** (ventana desde el deploy, hasta hoy):

```bash
node scripts/convex-usage/extract-all.mjs 2026-10-06 2026-10-XX
node scripts/convex-usage/analyze.mjs
```

Ojo al leer la serie diaria: los días ANTES del 6 por la tarde aún
llevan el ritmo viejo (el cambio entró en prod el 2026-10-06 ~13:45
local; el puente tomó el código nuevo al reiniciarse a esa hora).

## 3. Cómo se implementó

- `convex/schema.ts`: `WORKING_STATES` exportada junto a `agentStates`.
- `convex/agent.ts`: import de `WORKING_STATES` (agentOverview la usa
  para su bucket working), nueva query `agentWorkingTasks` con el mismo
  patrón de sesión (`sessionArg`) que `agentQueue`.
- `agent-bridge/dispatcher.mjs`: `recoverStuck` consulta la query
  liviana; timer `stuckTimer` (2 min) + llamada al arranque; `stop()`
  lo limpia.
- Deploy Convex prod 2026-10-06; puente reiniciado sin corridas activas
  (relanzado por el daemon, pid nuevo, log sin errores tras 2 ciclos del
  watchdog).

## 4. Qué probar para confiar

- Puente vivo: `agent-bridge/bridge.log` sin líneas `recoverStuck:`
  nuevas tras el 2026-10-06 13:45; heartbeat sigue a 60 s.
- Vista de agentes de la app: igual que siempre (agentOverview intacto).
- Flujo huérfano (cuando haya una corrida real): matar el puente a mitad
  → tarea en error a los ~7 min.
- El check de uso de la sección 2 en 2–3 días.

## 5. Efectos secundarios y deudas

- Detección de huérfanas: ~6 → ~7 min (gracia de 5 min preexistente +
  cadencia 2 min). Imperceptible.
- `take(25)` por estado working: techo teórico del watchdog (hoy 0–3).
- El costo restante del mes lo domina `tasks:list` (~12,5 MB/día,
  tablero reactivo): NO se tocó a propósito (la alternativa perdía la
  columna "completado" reactiva). Solo retomar si el ritmo post-check
  sigue > 30 MB/día.
- Watch items: `getSearchIndex` (lazy, 0 llamadas en oct pero ahora
  escanea ~25 lists del workspace por invocación) y `subtasks:allCounts`
  (1,3 MB/día, candidato a `count()` por índice).
