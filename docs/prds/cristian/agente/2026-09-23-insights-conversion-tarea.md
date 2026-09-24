# PRD: Insights de imprevistos — conversión a tarea, comparativa vs tareas y drawer redimensionable

| Campo | Valor |
|---|---|
| Fecha | 2026-09-23 |
| Dueño | Cristian |
| Módulo | UI (InsightsDrawer / panel Hoy) |
| Estado | hecho (verificado en navegador; arrastre validado por Cris) |

## 1. Problema

1. El visor no mostraba cuántos imprevistos se transformaron en tarea (por
   día y total).
2. Faltaban métricas imprevistos vs tareas.
3. El drawer solo tenía un toggle de ancho fijo: no se podía agrandar a
   gusto para leer mejor.

## 2. Solución

1. Contador `convertidos` por día (todo promovido, viva o completada la
   tarea): chip "N → tarea" en la fila del día + Stat total "Se
   transformaron en tarea: X de N (Y%)".
2. Sección "Imprevistos vs tareas": imprevistos por tarea planeada (N:1),
   % del trabajo que fue imprevisto, resueltos imprevisto-vs-plan,
   conversión con tarea completada, y barras comparativas por día (ámbar
   imprevistos / acento planeadas, escala común).
3. Drawer redimensionable: tirador en el borde IZQUIERDO (arrastrar a la
   izquierda agranda; límites 384px–92vw), ancho persistido en
   localStorage. El botón wide queda como atajo cuando no hay ancho manual.

## 3. Casos de prueba

1. Abrir insights: aparece el Stat de conversión y la sección comparativa;
   días con promovidos muestran "N → tarea". ✓
2. Arrastrar el borde izquierdo → el drawer se agranda en vivo y conserva
   el ancho al recargar. ✓ (validado por Cris con mouse real)
3. Rangos 7/14/30 recalculan todo. ✓

## 4. Criterios de aceptación

- [x] Build + tipos OK.
- [x] Sin cambios de backend (toda la agregación sigue client-side).
