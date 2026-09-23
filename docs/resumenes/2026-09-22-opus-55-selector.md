# Resumen post-implementación: Opus 5.5 en el selector de modelo de Claude

PRD: `docs/prds/cristian/agente/2026-09-22-opus-55-selector.md` · 2026-09-22
(directo en master a pedido de Cris)

## 1. Qué se implementó

- El selector de modelo de la delegación de agentes ofrece "Opus 5.5 High"
  para Claude Code, además de Sonnet 5 High y Opus 5 High existentes.

## 2. Cómo se implementó

- `convex/agent.ts` (`FALLBACK_MODELS_CLAUDE`): entrada
  `{ id: "claude/opus-5.5-high", label: "Opus 5.5 High" }` — es lo que el
  picker muestra mientras el puente no ha sincronizado el catálogo real.
- `agent-bridge/agents/claude.mjs` (`readClaudeCatalog`): misma entrada en el
  catálogo que el puente sincroniza al setting `agent.models.claude` vía
  `agent:syncModels` (en cada arranque del dispatcher).
- Nada más: el picker (`AgentDelegationSection.tsx`) es dinámico y renderiza
  lo que devuelve `api.agent.listModels`; los parseadores existentes ya
  aceptan versiones con punto (`[\d.]+`).

## 3. Por qué es la mejor forma

- El circuito del catálogo tiene exactamente dos fuentes (fallback Convex +
  catálogo del puente); tocar solo una dejaría el picker mostrando la lista
  vieja tras la primera sync del puente.
- Alternativa descartada: renombrar "Opus 5 High" en vez de agregar — se
  perdería la opción anterior y Cris pidió agregar.

## 4. Qué probar

1. Abrir la app → delegar tarea con executor Claude → el combo Modelo muestra
   "Sonnet 5 High", "Opus 5 High" y "Opus 5.5 High".
2. Delegar con "Opus 5.5 High" → en el log del puente, el spawn de
   `claude.exe` lleva `--model opus --effort high`.
3. Reiniciar el puente (`npm run agent-bridge`) → "modelos claude
   sincronizados: 3" en el log.

## 5. Efectos secundarios y deudas

- `claude/opus-5-high` y `claude/opus-5.5-high` mapean a los mismos flags del
  CLI (`--model opus`): la versión del id es etiqueta, el alias resuelve la
  versión real de la cuenta. Si algún día el CLI acepta ids con versión,
  `claudeModelFlags` puede pasarla.
- El setting `agent.models.claude` en Convex ya sincronizado se actualiza en
  el próximo arranque del puente; hasta entonces el picker sigue mostrando
  la lista vieja guardada (no el fallback).
