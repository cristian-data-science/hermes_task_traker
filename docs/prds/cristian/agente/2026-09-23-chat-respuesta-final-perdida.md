# PRD: El chat en vivo no muestra la respuesta final del agente Claude

| Campo | Valor |
|---|---|
| Fecha | 2026-09-23 |
| Dueño | Cristian |
| Módulo | agente (zchat: servidor + UI del chat) |
| Estado | hecho (reproducido, corregido y verificado con trazas de eventos) |

## 1. Problema

Al retomar el chat de una tarea (en ejecución o terminada) y preguntar, el
agente razona, ejecuta herramientas… y la respuesta final NO aparece. El
intercambio queda "mudo": el turno termina (header con modelo/tokens) sin
burbuja de respuesta.

**Diagnóstico**: el agente SÍ responde. Verificado en el caso real
(90d12d0c, 16:16): la respuesta completa (1.454 chars) está en el JSONL de
`~/.claude/projects/` y el zchat-server la capturó (log: "1454 chars, 5
bloques"). Al recargar el chat, la respuesta aparece. La pérdida es solo del
render en vivo del turno.

## 2. Para quién

> **Cris**, que pregunta en el chat de una tarea delegada a Claude y espera
> ver la respuesta sin recargar.

## 3. Causa raíz (3 bugs en `handleClaudeStreamEvent`)

Los índices de bloque del stream (`e.index`) se REINICIAN en cada mensaje
del turno, pero el código los trataba como globales:

1. `t.toolInput` (mapa `idx→toolId`) nunca se limpiaba entre mensajes: el
   `content_block_stop` de un bloque de TEXTO posterior matcheaba el mapa
   viejo → re-emitía la herramienta ya completada como "running" (tarjeta
   clavada en "ejecutando…") y el `return` temprano se comía el cierre del
   texto.
2. Los ids de parte `cb${index}` colisionaban entre mensajes: el bloque de
   texto del mensaje final SOBRESCRIBÍA el part de un texto anterior (p. ej.
   "Verifico en el código…" quedaba vacío/reemplazado) y desordenaba el
   orden de burbujas.
3. Los `thinking_delta` viajan en `d.thinking`, no en `d.text`: el
   razonamiento en vivo nunca se acumulaba (guard `if (d.text)`).

## 4. Solución

- `message_start` reinicia `t.toolInput` e incrementa `t.msgSeq`.
- Ids de bloques text/thinking pasan a `m${msgSeq}b${index}` (únicos por
  mensaje; sin colisiones ni sobrescrituras).
- El delta acumula `d.thinking` para thinking_delta y `d.text` para
  text_delta.

## 5. Casos de prueba

1. Pregunta con respuesta directa (sin tools) → burbuja final en vivo (ya
   funcionaba; regresión cubierta).
2. Pregunta texto→herramienta→texto final → la respuesta final streamea en
   vivo y las tarjetas de tools quedan ✓ (reproducido antes del fix: evento
   "part(tool|running)" DESPUÉS del completed; después del fix la secuencia
   queda limpia).
3. Razonamiento (thinking) visible en vivo mientras piensa.
4. Recargar el chat → historial idéntico a lo visto en vivo.

## 6. Criterios de aceptación

- [x] Trazas antes/después capturadas (SSE log UI + log servidor).
- [x] `node --check` de servidor y UI OK.
- [x] Servidor del chat relanzado limpio con el fix.
