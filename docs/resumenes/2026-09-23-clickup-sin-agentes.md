# Resumen post-implementación: ClickUp sin rastro de agentes

PRD: `docs/prds/cristian/agente/2026-09-23-clickup-sin-agentes.md` · 2026-09-23

## 1. Qué se implementó

- Lo que se publica a ClickUp (descripción de la tarea y comentario de
  cierre) ya no contiene referencias a agentes, IA, modelos ni
  automatización: pasa por `sanitizeAgentRefs` y lee como nota del dueño en
  primera persona.
- Prefijo de descripción: "Avance:" / "Hecho:" (antes "Avance del agente:").

## 2. Cómo se implementó

- `convex/clickup.ts`: `sanitizeAgentRefs` (frases de andamiaje primero,
  palabras después, limpieza de huecos; si el texto quedara vacío se
  conserva el original). Aplicado en `mcpTaskArgs` (descripción de tareas
  de agente) y en `postCompletionNote` (comentario al completar), encadenado
  tras `sanitizeLocalRefs`.

## 3. Qué probar

1. Tarea de agente con corrida terminada → descripción en ClickUp: "Avance:
   …" con el resumen en primera persona y sin agente/ZCode/Claude/IA/
   automático/tracker.
2. Al aprobar (hecho) → "Hecho: …" y el comentario de cierre también limpio.

## 4. Efectos secundarios y deudas

- El Vico ya se resincronizó con la descripción nueva (sin
  clickupSyncError). El token PERSONAL de la API de ClickUp
  (hermes/.env, pk_156…) devolvió "Token invalid" al querer verificarlo
  directo — la app no se ve afectada (usa su OAuth vía MCP), pero conviene
  rotarlo si se usa la skill de ClickUp.
- El saneo es por palabras: frases muy artificiales ("la ejecución fue
  automática") pueden quedar un poco toscas; los resúmenes reales no
  presentan el caso.
