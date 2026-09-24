# Resumen post-implementación: promedio de imprevistos por día laboral

PRD: `docs/prds/cristian/agente/2026-09-23-promedio-imprevistos-laboral.md` · 2026-09-23

## 1. Qué se implementó

- "Imprevistos/día laboral (prom.)": divide solo por los lunes a viernes
  presentes en la ventana (antes: días de calendario, contando el fin de
  semana). El hint de la tarjeta muestra la fórmula con los números del
  rango.

## 2. Cómo se implementó

- `src/components/InsightsDrawer.tsx`: `promedioDia = surgidos /
  buckets.length` (buckets ya contiene solo días hábiles, ceros incluidos)
  + label/hint nuevos. Sin cambios de backend.

## 3. Respuestas fijadas (revisión pedida por Cris)

- Fórmula anterior: surgidos ÷ 7 (calendario) → 8 ÷ 7 = 1,1 con datos
  reales; por eso parecía bajo.
- Fórmula nueva: 8 ÷ 5 días hábiles = 1,6.
- Imprevistos convertidos a tarea: SIGUEN contando en surgidos y en el
  promedio (promover no descuenta); solo cambia su clasificación de
  resolución. En la ventana real: 6 de 8 promovidos, los 8 cuentan.

## 4. Qué probar

1. Abrir insights 7d: la tarjeta muestra el promedio por día laboral y su
   hint "N ÷ M días hábiles".
2. Promover un imprevisto a tarea y recargar: el promedio no baja.

## 5. Efectos secundarios y deudas

- Ninguno conocido; la ventana sigue siendo de calendario (7/14/30), solo
  cambia el denominador del promedio.
