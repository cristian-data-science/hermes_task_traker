# Resumen post-implementación: el chat observador ya no pierde la respuesta final

PRD: `docs/prds/cristian/agente/2026-09-23-chat-observador-respuesta-final.md` · 2026-09-23

## 1. Qué se implementó

- Al terminar una corrida seguida en vivo desde el chat (modo observador),
  la respuesta final del agente ahora se renderiza antes del aviso "La
  corrida terminó". Antes se perdía: el poller de historial se apagaba sin
  barrer los últimos mensajes escritos por el agente justo antes de salir.

## 2. Cómo se implementó

- `agent-bridge/zchat-server.mjs` (`syncObserver`): barrido final de
  `readHistory` + `history_append` ANTES de `clearInterval` y del aviso de
  término. Sin cambios de protocolo ni de UI.

## 3. Evidencia

- Caso real de esta noche (sesión airflow 90d12d0c): la respuesta a la
  redirección "entonces que falta y en que parte" existía completa en el
  JSONL (2.079 chars, "Faltan 5 cosas…") y no se renderizó; el poll de 2 s
  corrió por última vez ~1 s antes de que el agente escribiera su texto
  final y `syncObserver(false)` cortó sin más.

## 4. Qué probar

1. Abre el chat de una tarea mientras corre; al terminar la corrida, la
   respuesta final debe aparecer (y luego el aviso de término).
2. Con redirección en vivo: la corrida retomada termina y su respuesta
   final también aparece.

## 5. Efectos secundarios y deudas

- Los servidores de chat YA abiertos con el código viejo deben recargarse
  (el zchat-server vive por chat; los nuevos ya sirven el fix).
- La respuesta parcial de la primera pregunta (matada por la redirección
  en vivo) es inherente al interrupt: la redirección PREVALECE y el proceso
  previo muere con su trabajo a medias (la respuesta completa la da la
  corrida retomada).
