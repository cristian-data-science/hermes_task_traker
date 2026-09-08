# PRD: Estrategia de Git explícita para tareas de desarrollo

| Campo | Valor |
|---|---|
| Fecha | 2026-09-07 |
| Dueño | Cristian |
| Módulo | agente (UI + Convex + prompt) |
| Estado | hecho (validado E2E: push directo a master vs rama) |
| Rama / PR | directo a master (patrón de los últimos features) |
| Relacionados | `CONTRATO_AGENTE.md`, `2026-09-07-claude-code-segundo-agente.md` |

## 1. Problema

Las tareas de desarrollo siempre iban a rama propia + PR. Cuando Cris quiere
un cambio chico directo en producción, el flujo de rama + PR + merge manual es
fricción innecesaria — pero forzarlo por prompt, tarea por tarea, no escala.

## 2. Para quién

> **Cris**, que decide POR TAREA si el agente trabaja con el flujo seguro
> (rama + PR) o si es un cambio que merece ir directo a main/producción.

## 3. Solución

- **Selector "Estrategia de Git"** en la sección Delegación, visible SOLO con
  tipo Desarrollo: 🔀 "Rama propia + PR" (default) / 🎯 "Directo a main"
  (con advertencia "⚠ Se publica a producción al pushear").
- **Campo `tasks.gitStrategy`** ("rama-pr" | "main-directo"); sin campo =
  rama-pr (tareas viejas, cero migración). Solo viaja con desarrollo.
- **Prompt de despacho**: con main-directo, bloque
  "ESTRATEGIA GIT: DIRECTO A MAIN (excepción explícita elegida por Cris)"
  que PISA la regla de oro de ramas y la receta de desarrollo: commits directos
  en master/main, verificación ANTES del push, push al verificar (producción
  por el pipeline del repo), evidencia con hashes. El resto del contrato
  sigue vigente.
- **Chip "⚠ directo a main"** en el header del panel de corridas.

## 4. Casos de prueba (validados E2E, 2026-09-07)

1. ✅ Tarea desarrollo + main-directo (Claude, autonomo): commit `a2b8cf1`
   DIRECTO en master y push a origin — sin rama, sin PR; corrida `hecho`.
2. ✅ Tarea desarrollo + default: rama `agent/scratch-test` con su commit,
   master intacto.
3. ✅ buildPrompt offline: bloque de excepción solo aparece con main-directo.
4. ✅ Selector solo visible con tipo desarrollo; default sin tocar = rama-pr.

## 5. Criterios de aceptación

- La elección queda explícita al crear la tarea y viaja en el contrato del
  despacho (auditable en promptDigest).
- "Directo a main" solo existe si se elige a propósito, con advertencia
  visible en UI y chip rojo en el panel de corridas.
