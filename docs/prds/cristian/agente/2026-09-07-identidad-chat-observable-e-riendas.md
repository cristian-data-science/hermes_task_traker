# PRD: Identidad de agente/modelo visible + chat observable + modo ejecución (riendas)

| Campo | Valor |
|---|
| Fecha | 2026-09-07 |
| Dueño | Cristian |
| Módulo | agente (UI + puente + chat) |
| Estado | hecho (validado E2E: observador mid-run, exec crea archivo, bind temprano zcode) |
| Rama / PR | feat/cristian/identidad-chat-observable |
| Relacionados | `docs/prds/cristian/agente/2026-09-07-claude-code-segundo-agente.md` |

---

## 1. Problema

Tres fricciones tras la integración multi-agente:

1. **Identidad mezclada**: la vista Agente (y otros puntos) dicen "ZCode" fijo
   y le appendean el modelo que venga — una tarea Claude con Sonnet muestra
   "ZCode · sonnet-5-high". El modelo aparece como id crudo, sin agente.
2. **Chat solo al final**: el 💬 requiere `agentSessionId`, que en ZCode se
   bindea al TERMINAR la corrida; durante la corrida no hay forma de ver el
   razonamiento en vivo desde el chat.
3. **Chat read-only siempre**: aunque Cris pida "ejecutá esto" en el chat, el
   agente no puede (plan/plan). El contrato limita al agente autónomo; cuando
   el dueño conduce la conversación, su palabra debe poder prevalecer.

## 2. Para quién (persona concreta)

> **Cris**, que delega a dos motores y necesita saber de un vistazo QUIÉN
> trabaja en cada tarea y con qué modelo/esfuerzo; quiere espiar el
> razonamiento mid-run; y quiere poder tomar las riendas por chat para que el
> agente ejecute lo que él pida aunque el contrato diga solo-lectura.

## 3. User journey

1. En tablero/vista Agente/panel de corridas, cada tarea delegada muestra
   siempre `agente · modelo` correctos (ej. "Trabajando · Claude Code ·
   Sonnet 5 High").
2. Durante una corrida, el 💬 ("Ver razonamiento en vivo") abre el chat en
   modo observador: historial vivo (mensajes nuevos aparecen), banner con
   agente+modelo+esfuerzo, composer bloqueado hasta que la corrida cierre.
3. Al terminar, pregunta normal con resume. En el composer hay un toggle
   "👁 Solo consulta ↔ ⚡ Modo ejecución": al activarlo (con confirmación),
   lo que Cris pida se ejecuta de verdad (bypass/yolo) y el contrato de la
   tarea queda subordinado a sus instrucciones explícitas del chat.

## 4. Alcance

**Sí incluye:** helper `agentModelLabel`; fixes de identidad en AgentView,
TaskCard, AgentRunsPanel, chat UI; bind temprano de sesión zcode (watchSession
sobre db.sqlite por título `agente- <título>%`); modo observador del chat
(history_append por SSE, 409 en /ask, notice al cerrar); modo ejecución
(POST /mode, spawn yolo/bypass, prefijo de rienda en el prompt, toggle con
confirmación y estado visual); badge de identidad en el header del chat con
modelo + esfuerzo.

**No incluye:** ejecución mid-corrada (mientras corre el dispatcher no se
puede preguntar); persistencia del modo ejecución entre aperturas del chat
(vive por instancia); cambios en el contrato editable.

## 5. Diseño técnico

- Etiqueta: `agentModelLabel()` en `src/lib/utils.ts` (claude/opus-5-high →
  "Opus 5 High"; zcode → último segmento; vacío → "").
- Bind temprano: `agents/zcode.mjs watchSession(run, api)` — poll 3 s a
  db.sqlite `session` por título LIKE, defensivo si no hay columna de tiempo.
- Observador: en `zchat-server`, `tracker.run.open` → poll readHistory 2 s,
  diff por id de mensaje → `history_append`; `/ask` 409; `/state.observer`.
- Ejecución: estado `execMode` + `POST /mode` + evento `mode`; `runTurn`
  elige flags (zcode yolo / claude bypassPermissions) y prefijo
  (ASK_PREFIX ↔ EXEC_PREFIX); `stripWrappers` limpia ambos.
- UI chat: badge header, banner observador, `setObserver()`, toggle ⚡ con
  modal de confirmación y acento visual.

## 6. Casos de prueba (resumen)

1. Vista Agente/tarjetas: tarea Claude muestra Claude Code + modelo bonito.
2. Mid-run: 💬 disponible, chat observador, ask 409, mensajes fluyen.
3. Fin de corrida: notice + ask OK (resume conserva contexto).
4. Modo 👁: pedido de crear archivo NO se ejecuta.
5. Modo ⚡: mismo pedido SÍ crea el archivo en la carpeta.
6. Zcode: agentSessionId presente antes del fin de la corrida.

## 7. Criterios de aceptación

- Ninguna superficie muestra "ZCode" para una tarea Claude (ni modelo crudo).
- El chat es abrible en cualquier estado post-dispatch y muestra identidad
  agente+modelo+esfuerzo siempre visible.
- El modo ejecución está explícito, confirmado y visible; el read-only
  sigue siendo el default.
