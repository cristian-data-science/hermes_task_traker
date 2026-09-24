# PRD: El chat observador pierde la respuesta final de la corrida

| Campo | Valor |
|---|---|
| Fecha | 2026-09-23 |
| Dueño | Cristian |
| Módulo | agente (zchat-server, modo observador) |
| Estado | hecho (causa verificada contra el JSONL real) |

## 1. Problema

En el chat siguiendo una corrida EN VIVO (modo observador), la respuesta
final del agente no aparece: quedan las herramientas y el aviso "La corrida
terminó", pero sin texto. Caso real (sesión 90d12d0c, redirección
"entonces que falta y en que parte"): la respuesta completa (2.079 chars,
"Faltan 5 cosas…") quedó escrita en el JSONL (línea 527) pero jamás se
renderizó.

## 2. Causa raíz

`syncObserver(false)` apagaba el poller de historial SIN barrido final: la
respuesta final se escribe al JSONL entre el último tick (2 s) y el cierre
de la corrida — segundos antes de que el proceso salga — y caía en ese
hueco. Correlativo del bug de la mañana (turnos del propio chat), pero en
el camino OBSERVADOR (poll de historial), que es código distinto.

## 3. Solución

Barrido final del historial ANTES de apagar el poller y de emitir el aviso
"La corrida terminó" (mismo diff por ids; los últimos mensajes del agente
se emiten como history_append y la UI los renderiza igual).

## 4. Casos de prueba

1. Corrida con redirección en vivo: al terminar, la respuesta final del
   agente aparece antes del aviso de término (antes: solo herramientas).
2. Corrida normal: ídem.
3. Recargar el chat siempre muestra todo (histórico intacto).

## 5. Criterios de aceptación

- [x] Evidencia: respuesta existente en JSONL + poller cortado sin barrido.
- [x] `node --check` OK.
