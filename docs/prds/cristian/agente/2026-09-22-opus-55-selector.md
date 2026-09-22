# PRD: Opus 5.5 en el selector de modelo de Claude

| Campo | Valor |
|---|---|
| Fecha | 2026-09-22 |
| Dueño | Cristian |
| Módulo | agente (puente + catálogo) |
| Estado | hecho (directo en master a pedido de Cris) |

## 1. Problema

El selector de modelo de la delegación de agentes solo ofrece Sonnet 5 High y
Opus 5 High para Claude Code; no hay opción de Opus 5.5.

## 2. Para quién

> **Cris**, que delega tareas a Claude Code y quiere elegirlas con Opus 5.5.

## 3. Solución

Agregar `claude/opus-5.5-high` ("Opus 5.5 High") a las DOS listas del catálogo:

- `convex/agent.ts` → `FALLBACK_MODELS_CLAUDE` (lo que muestra el picker antes
  de que el puente sincronice).
- `agent-bridge/agents/claude.mjs` → `readClaudeCatalog()` (catálogo real que
  el puente sincroniza al setting `agent.models.claude`).

Los parseadores existentes (flags del CLI, labels del frontend y del zchat-ui)
ya aceptan versiones con punto (`[\d.]+`): `claude/opus-5.5-high` →
`--model opus --effort high` y label "Opus 5.5 High". Sin cambios adicionales.

## 4. Alcance

- Solo el catálogo Claude. No se toca ZCode ni el flujo de despacho.
- Los ids siguen mapeando a alias del CLI (`--model opus`): la versión del
  id es etiqueta; el CLI resuelve qué Opus usa la cuenta.

## 5. Casos de prueba

1. Picker de delegación con executor Claude → aparece "Opus 5.5 High".
2. Tarea delegada con ese modelo → spawn con `--model opus --effort high`.
3. Sin sync del puente → el fallback también lista las 3 opciones.

## 6. Criterios de aceptación

- [x] Las dos listas tienen la entrada nueva idéntica (id y label).
- [x] `tsc -b && vite build` pasa.
- [x] `node --check` del adaptador pasa.
