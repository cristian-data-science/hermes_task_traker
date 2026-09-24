# PRD: Orden del modal de tarea — área y estado primero

| Campo | Valor |
|---|---|
| Fecha | 2026-09-23 |
| Dueño | Cristian |
| Módulo | UI (TaskModal) |
| Estado | hecho (verificado en navegador dev) |

## 1. Problema

El modal abría con Título y Notas primero; Área y Estado quedaban abajo en
"Planificación". Cris clasifica antes de escribir: quiere ver Área, Estado,
Título, Notas — y la delegación al agente después de eso.

## 2. Solución

Sección "Tarea": Área (radiogroup) → Estado (select) → Título → Notas →
Súper urgente. Sección "Planificación": Fecha de entrega, Solicitado por,
Estimación, Progreso (Área y Estado salieron de acá; Fecha dejó de compartir
grilla con Estado). El resto (ejecutor/delegación, ClickUp, seguimiento)
queda después, sin cambios.

## 3. Casos de prueba

1. Nueva tarea / editar tarea: el orden visible es Área, Estado, Título *,
   Notas; el autofocus sigue en Título.
2. Cambiar área/estado desde arriba comporta igual que antes (mismos
   handlers, sin lógica nueva).
3. Standby/Programado condicionales siguen apareciendo bajo Fecha.

## 4. Criterios de aceptación

- [x] Build + tipos OK.
- [x] Orden verificado en el navegador (dev).
