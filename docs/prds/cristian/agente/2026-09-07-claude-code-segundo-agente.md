# PRD: Claude Code como segundo agente del puente Hermes

| Campo | Valor |
|---|---|
| Fecha | 2026-09-07 |
| Dueño | Cristian |
| Módulo | agente (puente local + Convex + UI) |
| Estado | hecho (validado E2E: despacho sonnet/opus, chat streaming, paralelismo con zcode) |
| Rama / PR | feat/cristian/claude-code-agente |
| Relacionados | `CONTRATO_AGENTE.md`, `agent-bridge/README.md` |

---

## 1. Problema

El tracker delega tareas de código solo a ZCode. Cris también tiene una cuenta
Enterprise de Claude Code en la CLI y quiere poder elegir, al crear la tarea,
si la ejecuta ZCode o Claude Code — y chatear con la sesión del agente elegido
igual que hoy chatea con ZCode.

## 2. Para quién (persona concreta)

> Este feature es para **Cris**, que paga/planea con dos motores de agente
> (GLM vía ZCode, Claude vía Enterprise) y hoy tiene que abrir Claude Code a
> mano fuera del tracker. Después de esto, elige el ejecutor y el modelo en el
> mismo formulario de la tarea y sigue todo desde el tablero y el chat.

## 3. User journey (paso a paso)

1. Cris crea/edita una tarea y en **Ejecutor** elige `ZCode` o `Claude Code`.
2. Al elegir Claude, la sección Delegación muestra el **selector de modelo**:
   Sonnet 5 High u Opus 5 High (default de la cuenta si no elige).
3. Guarda → la tarea queda `encolada`; el puente la recluta, lanza
   `claude -p <prompt> --permission-mode bypassPermissions --model <m> --effort high
   --output-format json` en el workspace elegido.
4. El agente Claude reporta plan/pasos/estado con el mismo `report.mjs` → la
   tarea avanza en el Kanban idéntico a ZCode (misma máquina de estados).
5. Cris apreta 💬 en la tarea → el chat abre la sesión de Claude de esa tarea:
   historial completo, streaming, herramientas, panel de misión.

## 4. Alcance

**Sí incluye:**
- `executor` admite `"claude"` en todo el stack (schema, validadores, UI).
- Capa de adaptadores en `agent-bridge/agents/` (`zcode.mjs`, `claude.mjs`):
  spawn, sesión, stream, historial, actividad, modelos.
- Dispatcher multi-agente: lanes de concurrencia independientes (lock de swap
  de modelo solo aplica a zcode; claude usa `--model`/`--effort` por corrida).
- Catálogo de modelos Claude sincronizado a settings (Sonnet 5 High,
  Opus 5 High) + default de cuenta.
- Hooks Stop/SessionStart registrados también en `~/.claude/settings.json`
  (mismos scripts, gateados por env `ZCODE_TASK_ID`).
- Chat multi-agente: deep link `hermesagent://claude`, historial desde
  `~/.claude/projects/`, streaming stream-json, tracker igual.
- Badge del agente en chat y tarjetas de tarea.

**No incluye (qué NO hacemos y por qué):**
- Cambiar `claw` (queda como label sin dispatch, como hoy).
- Migrar sesiones entre agentes (una tarea arranca y sigue con su agente).
- UI de credenciales: el CLI ya está logueado con la cuenta Enterprise.
- Menciones/agentes en un chat grupal: el chat sigue siendo por tarea.

## 5. Diseño técnico (diagrama)

```
TaskModal (executor=claude, model=sonnet|opus high)
   └─> Convex tasks (agentState=encolada) ── agent:agentQueue ──> dispatcher
          dispatcher elige adaptador por task.executor
          ├─ agents/zcode.mjs  (hoy: zcode -p --mode yolo --json + swapModel)
          └─ agents/claude.mjs (claude -p --permission-mode bypassPermissions
                                 --model <alias> --effort high
                                 --output-format json|stream-json, cwd=workspace)
                 sesión: evento system/init (uuid) ──> agent:bindSession
                 historial: ~/.claude/projects/<cwd>/<session>.jsonl
                 reporte: report.mjs (compartido, mismo contrato)
   └─> 💬 hermesagent://claude?path&session&task → zchat-server (adaptador)
```

Verificado en la máquina (CLI 2.1.263, cuenta Enterprise):
`--model sonnet|opus` → `claude-sonnet-5`/`claude-opus-5`; `--effort
low|medium|high|xhigh|max`; `--resume <uuid>` mantiene memoria;
stream-json emite `system/init`, `stream_event` (text_delta, thinking_delta,
content_block tool_use), `assistant`, `result`; JSONL por sesión en
`~/.claude/projects/` con roles user/assistant y bloques text/thinking/tool_use.

## 6. Casos de prueba (resumen)

1. Crear tarea executor=claude modelo sonnet-high → despacha → reporta → hecho.
2. Ídem opus-high; verificar `agentRuns.model` correcto por corrida.
3. Follow-up (re-dispatch) continúa la MISMA sesión (`--resume`).
4. Chat de tarea Claude: historial, streaming, tools, cancelar, tracker vivo.
5. Paralelismo: tarea zcode (swap lock) + tarea claude simultáneas sin pisarse.
6. Tarea claude sin modelo → usa default de cuenta (opus).
7. Executor cambiado claude→cris → estado agente se limpia (como zcode).
8. Regresión: flujo zcode completo intacto (dispatch, chat, modelos).
9. Timeout/stall de corrida claude → watchdog la marca error.
10. Pregunta del agente (`pregunta`) → responder desde el tracker → sigue.

## 7. Criterios de aceptación

- El dropdown Ejecutor ofrece ZCode y Claude Code; el de Modelo ofrece
  Sonnet 5 High / Opus 5 High cuando el ejecutor es Claude.
- Una tarea Claude recorre encolada→trabajando→hecho visible en el Kanban.
- El chat de una tarea Claude es indistinguible en features del de ZCode.
- Corridas ZCode existentes siguen funcionando sin cambios de comportamiento.
