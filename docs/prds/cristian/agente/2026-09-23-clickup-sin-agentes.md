# PRD: ClickUp sin rastro de agentes — notas en voz del dueño

| Campo | Valor |
|---|---|
| Fecha | 2026-09-23 |
| Dueño | Cristian |
| Módulo | agente (ClickUp outbound) |
| Estado | hecho (sanitizador probado con el resumen real del Vico; deploy prod) |

## 1. Problema

La descripción de la tarea Vico en ClickUp decía "Avance del agente: …":
revela que un agente/IA trabaja el proyecto. Regla de Cris: ClickUp cuenta
el PROYECTO, no el proceso — nunca referencias a agentes, IA, modelos ni
automatización, y la nota debe leer como escrita por él en primera persona
(por si alguien la lee en el futuro).

## 2. Solución

- `sanitizeAgentRefs` (convex/clickup.ts): neutraliza el andamiaje antes
  de publicar — puente/tracker/agent-bridge/report.mjs, nombres de
  agentes/modelos (ZCode, Claude, GLM, Opus…), "agente"→"equipo",
  bot/asistente/IA, automátic*/automatizad*; limpia huecos de los
  reemplazos. La primera persona queda como está (lee como el dueño).
- Aplicado en los DOS puntos de salida: descripción
  (`mcpTaskArgs`: "Avance:"/"Hecho:" + resumen saneado) y comentario de
  cierre (`postCompletionNote`).
- Prefijo "Avance del agente:" → "Avance:".

## 3. Casos de prueba

1. Resumen real del Vico saneado: "el reporte al tracker quedó…" → "el
   reporte quedó…", "El agente lo reintentará" → "El equipo lo
   reintentará"; primera persona intacta. ✓
2. Resync manual del Vico (tasks.update) → sin clickupSyncError. ✓

## 4. Criterios de aceptación

- [x] Build + deploy Convex prod.
- [x] La descripción/comentario nunca contienen: agente, ZCode, Claude,
      GLM, IA, bot, automátic*, puente, tracker.
