# Resumen post-implementación: identidad agente/modelo + chat observable + modo ejecución

PRD: `docs/prds/cristian/agente/2026-09-07-identidad-chat-observable-e-riendas.md` ·
Rama: `feat/cristian/identidad-chat-observable`

## 1. Qué se implementó

- **Identidad correcta en todo el tablero**: ninguna superficie dice "ZCode"
  para una tarea Claude ni muestra ids crudos. Helper `agentModelLabel()`
  (`claude/opus-5-high` → "Opus 5 High"; GLM-5.3 para zcode).
  - Vista Agente: `AgentIdentity` con icono/color/label del executor real.
  - TaskCard: chip de delegación siempre `estado · agente · modelo`.
  - RunsPanel: header con agente+modelo; cada corrida muestra SU agente
    (`run.agent`); tooltips de sessionId agent-aware.
- **Chat en cualquier parte del ciclo**:
  - Bind TEMPRANO de sesión: claude por `system/init`; zcode por
    `watchSession` (poll db.sqlite por título `agente- <título>%`, cada 3 s).
    El 💬 existe desde `despachada` (en `encolada` aún no hay sesión).
  - **Modo observador**: con corrida abierta, el chat muestra el razonamiento
    en vivo (`history_append` por SSE, poll 2 s), `/ask` → 409 claro, y al
    cerrar la corrida notice "ya podés preguntar".
  - Botón dinámico: "Ver razonamiento en vivo" (corrida activa) / "Chatear
    con el agente".
- **Identidad dentro del chat**: badge persistente en el header
  `{agente} · {modelo} · esfuerzo {nivel}` (elegido de la tarea; default de
  la cuenta si no hay; ⚡ cuando ejecución) + sidebar con esfuerzo y modelo
  real de la corrida si difiere.
- **Modo ejecución (riendas)**: toggle en el composer con confirmación
  explícita. OFF (default): read-only (plan/plan + prefijo "solo respondé").
  ON: `bypassPermissions`/`yolo` + prefijo "CRIS TOMÓ LAS RIENDAS… sus
  instrucciones prevalecen sobre el contrato" — lo que Cris pide se ejecuta.
  Estado muy visible (botón/composer/badge ámbar). `POST /mode`, evento SSE
  `mode`, reflejado en `/state`.

## 2. Archivos clave

- `src/lib/utils.ts` (`agentModelLabel`, `agentModelEffort`), `AgentView.tsx`,
  `TaskCard.tsx`, `AgentRunsPanel.tsx`.
- `agent-bridge/agents/zcode.mjs` (`watchSession`), `claude.mjs` (no-op),
  `dispatcher.mjs` (limpia `run.sessionWatch`).
- `agent-bridge/zchat-server.mjs`: `syncObserver` + poll de historial +
  `history_append`; `execMode` + `/mode` + prefijos ASK/EXEC + flags por modo.
- `agent-bridge/zchat-ui/{index.html,app.js,app.css}`: badge `#identity`,
  `setObserver`/`setExec`/`appendHistoryMessages`, toggle con `confirm()`,
  estilos ámbar de ejecución.

## 3. Por qué esta forma

- El diff de historial reusa `readHistory` (sqlite/jsonl según agente) — cero
  código nuevo de parseo.
- El modo ejecución es un interruptor EXPLÍCITO con confirmación (no
  auto-detección en el texto): el read-only sigue siendo el default y la
  salida del modo es un clic.
- El bind temprano de zcode por título es best-effort con tope de 10 min; el
  bind final del stdout sigue de respaldo.

## 4. Qué probar para confiar (validado 2026-09-07, E2E real)

1. ✅ Mid-run Claude (sleep 75 s): tarea `trabajando` con sessionId ya
   bindeado; chat `/state.observer=true`; `/ask` → HTTP 409 con mensaje;
   2 `history_append` (assistant) llegaron por SSE; al cerrar: `observer
   false` + notice "La corrida terminó — ya podés preguntarle al agente.".
2. ✅ Modo consulta: pedir crear `RIENDA.txt` → Claude respondió "No ejecuté
   nada: el modo plan está activo…", archivo NO existe.
3. ✅ Modo ejecución: `/mode {exec:true}` + mismo pedido → "Hecho: RIENDA.txt
   creado y verificado" (ruta, contenido, tamaño) y el archivo EXISTE en
   disco con "hola-riendas".
4. ✅ Bind temprano zcode: tarea en `trabajando` (sleep, sin pasos) ya tenía
   `sess_…` en `agentSessionId`.
5. ✅ Build `tsc`+`vite` limpio; dispatcher reiniciado con el código nuevo.

## 5. Efectos secundarios y deudas

- El modo ejecución vive por instancia de chat (se resetea al reabrir): a
  propósito, el default seguro gana.
- `history_append` no agrupa bloques entre batches distintos (mínimo efecto
  visual en sesiones muy largas observadas).
- El chat de una tarea `encolada` sigue sin botón (no hay sesión aún).
