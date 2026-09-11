# Resumen: períodos de ausencia anotados en insights (2026-09-11)

Decisión previa conversada (no hay PRD separado): marcar, no recalcular.

## Qué

- Nuevo concepto **período de ausencia** (área Patagonia): lista de
  `{desde, hasta, etiqueta}` en settings (`ausencias.periodos`), editable
  como lista en el panel de configuración (engranaje).
- **Anotación, no cálculo**: cuando el rango mostrado de un insight solapa
  un período, aparece un banner ámbar ("🧳 Período de ausencia (Vacaciones):
  14 sept – 20 sept 2026 — incluye días sin actividad"). Los números no se
  excluyen ni se ajustan; solo se etiquetan (misma filosofía de "honestidad
  de datos" de InsightsView).
- Cubre **InsightsView** (dashboard completo, incluidos los bloques de
  imprevistos) y **InsightsDrawer** (insights de imprevistos del panel Hoy,
  rangos 7/14/30). En InsightsView el aviso se muestra con filtro "Todas" o
  "Patagonia" (la ausencia es scoped a Patagonia); con DataCEF/Personal no.
- Semilla inicial precargada mientras la clave no exista: **Vacaciones
  2026-09-14 → 2026-09-20** (salida lunes 14, regreso lunes 21; "hasta" es
  el último día ausente). Al guardar desde configuración queda explícito.

## Cómo

- `convex/ausenciasConfig.ts`: clave, parseo tolerante (JSON roto/filas
  inválidas se descartan, nunca lanza) y semilla.
- `convex/settings.ts`: `listarAusencias` (query con sesión) y `setAusencias`
  (mutation con sesión, re-valida y normaliza server-side).
- `src/lib/ausencias.ts`: `ausenciasSolapadas` (solape de rangos con bordes
  inclusivos en día local) y `rangoAusenciaLegible`.
- Banners en `InsightsView.tsx` y `InsightsDrawer.tsx`; editor en
  `ClickUpSettings.tsx` (etiqueta + input date desde/hasta + borrar/agregar/
  guardar). Sin cambios de schema (usa la tabla `settings`).

## Por qué así

Dos semanas sin registrar nada ensucian sobre todo el ciclo de las tareas
que quedaron abiertas, el headline "vs semana pasada", el throughput semanal
y la tendencia de imprevistos (falsa mejora). Excluir datos también mentiría
(la tarea sí envejeció); anotar da justificación al número bajo sin tocar el
histórico. Discutido y acordado con Cris antes de implementar.

## Deuda / siguientes

- El catch-up semanal (headline "Cerraste N (−M vs semana pasada)") no está
  anotado todavía; mismo helper servirá si se quiere.
- Los cálculos siguen incluyendo vacaciones por diseño (anotación, no
  exclusión); si algún día se pide excluir días, es una capa aparte.
