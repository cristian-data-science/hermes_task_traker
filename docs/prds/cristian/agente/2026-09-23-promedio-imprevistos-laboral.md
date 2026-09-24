# PRD: Promedio de imprevistos por día LABORAL

| Campo | Valor |
|---|---|
| Fecha | 2026-09-23 |
| Dueño | Cristian |
| Módulo | UI (InsightsDrawer) |
| Estado | hecho (fórmula verificada con datos reales de prod) |

## 1. Problema

"Imprevistos/día (prom.)" dividía por los días de CALENDARIO del rango
(7/14/30): el 7d contaba sábado y domingo en el denominador aunque la
grilla solo muestra lunes a viernes. Con datos reales: 8 imprevistos en la
ventana ÷ 7 = 1,1 (Cris veía ~1,5) cuando los días hábiles eran 5 → 1,6.

## 2. Solución y fórmula

`promedio = imprevistos surgidos en la ventana ÷ días LUN–VIE presentes en
la ventana` (buckets ya los contiene, ceros incluidos). Los surgidos en
fin de semana ruedan al lunes: cuentan en el numerador y pesan sobre ese
día hábil. Label pasa a "Imprevistos/día laboral (prom.)" con hint de la
fórmula exacta.

**Los convertidos a tarea SIGUEN contando**: todo imprevisto suma a
"surgidos" (y al promedio) se haya promovido o no — promover solo cambia su
clasificación de resolución (promovido en curso / promovido completado).

## 3. Casos de prueba

1. 7d con ventana que cruza un fin de semana: denominador = 5 o 6 (no 7). ✓
2. Hint muestra "N imprevistos ÷ M días hábiles". ✓
3. Promover un imprevisto no baja el promedio. ✓

## 4. Criterios de aceptación

- [x] Build + tipos OK.
- [x] Cifra verificada contra prod (8 ÷ 5 = 1,6).
