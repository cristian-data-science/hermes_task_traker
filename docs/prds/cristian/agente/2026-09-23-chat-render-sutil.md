# PRD: Chat menos invasivo — razonamiento y herramientas sutiles

| Campo | Valor |
|---|---|
| Fecha | 2026-09-23 |
| Dueño | Cristian |
| Módulo | agente (zchat-ui) |
| Estado | hecho (verificado con turno demo + análisis visual) |

## 1. Problema

El render del chat es invasivo: el razonamiento abre una caja grande
(borde + fondo, hasta 280px de texto streameando) por defecto mientras el
agente piensa, y cada herramienta es una tarjeta de ancho completo — con
varias herramientas el turno se vuelve un muro de cajas antes de la
respuesta.

## 2. Para quién

> **Cris**, que conversa con el agente en el chat y quiere leer la
> RESPUESTA sin que el proceso la sepulte.

## 3. Solución

- Razonamiento: línea callada cerrada por defecto ("Razonando…/Razonó ·
  duración · caracteres"), expandible para ver el stream (clic); el cuerpo
  abierto se ve como cita sutil (regla izquierda punteada), no caja.
- Herramientas: chips compactos en nube (flex-wrap, pill) en vez de
  tarjetas apiladas; la que corre lleva acento, las completas quedan
  atenuadas; la salida sigue desplegándose bajo el chip (clic).
- Aplica igual al vivo y al historial (comparten makeThink/makeTool).
- Además se verificó: el bug de la respuesta perdida NO aplica a ZCode
  (ids por mensaje + toolCallId explícito en su handler).

## 4. Casos de prueba

1. Turno con razonamiento + 2+ herramientas + respuesta: la respuesta
   domina visualmente; razonamiento = una línea; herramientas = chips.
2. Clic en "Razonó" → se expande el texto; clic en un chip → su salida.
3. Historial recargado → misma vista sutil.
4. Modo demo (`ZCHAT_DEMO=1`) reproduce todo sin gastar tokens.

## 5. Criterios de aceptación

- [x] `node --check` de app.js OK.
- [x] Turno demo verificado en navegador (estructura DOM + capturas).
