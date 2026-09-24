# Resumen post-implementación: insights de imprevistos con conversión a tarea y drawer redimensionable

PRD: `docs/prds/cristian/agente/2026-09-23-insights-conversion-tarea.md` · 2026-09-23

## 1. Qué se implementó

- El visor de insights de imprevistos ahora muestra cuántos se
  transformaron en tarea (por día con chip "N → tarea" y total con
  porcentaje).
- Sección nueva "Imprevistos vs tareas": ratio N:1, % del trabajo que fue
  imprevisto, resueltos imprevisto-vs-plan, conversión completada y barras
  comparativas por día.
- El drawer se agranda arrastrando su borde izquierdo hacia la izquierda
  (ancho persistido); el botón de ancho sigue de atajo.

## 2. Cómo se implementó

- `src/components/InsightsDrawer.tsx`:
  - `DayBucket.convertidos` (todo promovido, sin importar si la tarea ya se
    completó — eso ya lo cuenta "resueltos") + chips/Stat/derivados.
  - Sección comparativa reutilizando el componente Stat + mini gráfico de
    dos barras por día con escala común.
  - Resize: `startDrag` con listeners de pointermove/up en `window` (el
    arrastre termina lejos del tirador; la captura de puntero no se puede
    asumir), clamp 384px–92vw, persistencia del último ancho en
    `hermes-insights-width`; `widthPx` pisa las clases max-w del toggle.

## 3. Qué probar

1. Panel Hoy → Insights de imprevistos: Stat "Se transformaron en tarea" y
   sección "Imprevistos vs tareas" con las barras por día.
2. Arrastrar el borde izquierdo del drawer: se agranda en vivo y recuerda
   el ancho al reabrir/recargar.
3. Cambiar 7d/14d/30d: todo recalcula.

## 4. Efectos secundarios y deudas

- Solo frontend: sin migraciones ni cambios de API.
- El ancho manual convive con el botón wide: el último drag manda; para
  volver al comportamiento por defecto habría que borrar la clave de
  localStorage (aceptable por ahora).
