# Resumen post-implementación: Claude Code como segundo agente del puente

PRD: `docs/prds/cristian/agente/2026-09-07-claude-code-segundo-agente.md` ·
Rama: `feat/cristian/claude-code-agente`

## 1. Qué se implementó

- **Ejecutor "Claude Code"** en todo el stack: dropdown de Ejecutor del
  TaskModal, badges de tarjeta, insights por ejecutor, y schema/validadores
  Convex (`tasks.executor` + `"claude"`).
- **Selector de modelo por agente** en la sección Delegación: ZCode muestra su
  catálogo GLM; Claude ofrece **Sonnet 5 High** y **Opus 5 High** (catálogo
  sincronizado por el puente a `agent.models.claude`; default de la cuenta si
  no se elige).
- **Capa de adaptadores** `agent-bridge/agents/` (`zcode.mjs`, `claude.mjs`):
  el dispatcher y el chat eligen el motor por executor. Claude: spawn
  `claude.exe -p … --permission-mode bypassPermissions --model <alias>
  --effort high --output-format stream-json --verbose`, cwd = carpeta.
- **Dispatcher multi-agente con lanes**: zcode mantiene la regla del swap
  (default ×2 paralelo, otro modelo exclusivo); claude corre hasta
  `MAX_PARALLEL_CLAUDE=1` por flag — tareas de ambos agentes conviven.
- **Actividad en vivo de Claude** desde su propio stdout (system/init → bind
  temprano de sesión; eventos assistant → "qué está haciendo").
- **Hooks del puente también en Claude**: `register-hooks.mjs` registra
  Stop/SessionStart en `~/.claude/settings.json` (mismos scripts, no-op sin
  `ZCODE_TASK_ID`); session-hook ahora emite ambos protocolos de contexto.
- **Chat full integrado**: deep link `hermesagent://claude` → mismo
  zchat-server con adaptador; historial desde `~/.claude/projects/` con
  correlación tool_use↔tool_result; streaming token a token
  (`--include-partial-messages`); turno read-only (`--permission-mode plan`);
  badge del agente en header/sidebar de la UI del chat.

## 2. Cómo se implementó (archivos y decisiones)

- `convex/schema.ts` `tasks.executor` + `"claude"`; `agentRuns.agent`
  (zcode|claude); `convex/tasks.ts` y `convex/agent.ts` pasan a
  `isDelegatedExecutor()` (guards genéricos); `claimTask` persiste el agente;
  `listModels`/`syncModels` aceptan `agent` (key `agent.models.claude`).
- `agent-bridge/agents/`: adaptadores con interfaz común (`buildSpawn`,
  `extractSessionId/Response`, `sessionAlive`, `onStdoutLine`, `startTailer`,
  `modelCatalog`, `needsSwap`). zcode.mjs es la lógica extraída del
  dispatcher viejo, sin cambios de comportamiento.
- Sesión Claude = uuid del evento `system/init`; vive como JSONL en
  `~/.claude/projects/<cwd-codificado>/`; `sessionAlive` = existe el archivo.
- Modelos: ids internos `claude/sonnet-5-high` y `claude/opus-5-high`
  mapeados a `--model sonnet|opus --effort high` (verificado: `--effort`
  existe en CLI 2.1.263; `sonnet` resuelve a `claude-sonnet-5`).
- Autonomía → `bypassPermissions` (misma lección empírica que zcode/yolo:
  modos con permisos se cuelgan sin TTY); límites contractuales + timeout.
- `zchat-server.mjs` v4: posicional `[agent]`, `readClaudeHistory()`,
  `handleClaudeStreamEvent()` (traduce stream_event/assistant/user-tool_result
  al protocolo de partes existente — la UI no cambió de contrato).
- `protocol-handler.vbs`: host `claude` → mismo chat, 8º argumento = agente.

## 3. Por qué esta forma (y alternativas descartadas)

- **Adaptadores en el puente** y no un segundo daemon: un solo lockfile,
  heartbeat y cola; el motor es un detalle del executor.
- **Modelo por flag** en vez de replicar el swap: Claude no tiene config
  global que tocar → sin exclusividad y sin riesgo de dejar config sucia.
- **stream-json en el dispatcher** (no solo `--json`): da session_id temprano
  (bind aunque el proceso muera) y actividad en vivo sin tailer de archivos.
- Descartado: SDK de Claude (dependencia nueva) — el CLI ya está instalado,
  logueado y verificado headless; descartado migrar sesiones entre agentes.

## 4. Qué probar para confiar (validado 2026-09-07, todo E2E en prod)

1. Crear tarea ejecutor **Claude Code**, modelo **Sonnet 5 High** → guardar →
   despacha en segundos → plan/pasos visibles en la tarjeta → `hecho`/completado.
   ✅ Probado: corrida con `agent:"claude"`, `model:"claude/sonnet-5-high"`,
   protocolo completo y sesión uuid bindeada.
2. 💬 Chatear con esa tarea: historial, respuesta en vivo con streaming,
   herramientas, tokens y modelo por turno. ✅ Probado: 27 deltas, respuesta
   correcta con memoria de la sesión (`--resume`).
3. **Opus 5 High**: ✅ igual que Sonnet, `model:"claude/opus-5-high"`.
4. **Paralelismo**: tarea Claude + tarea ZCode simultáneas. ✅ Probado: ambas
   "▶ despachando … (paralela, 2 activas)", ambas `hecho`.
5. Regresión ZCode: flujo intacto (spawn, reporte, sesión `sess_…`). ✅.
6. Sin modelo → default de la cuenta (settings `opus[1m]`). ✅ sincronizado.

## 5. Efectos secundarios y deudas

- `agentRuns` viejos quedan con `agent` undefined = zcode (por diseño).
- El chat Claude no tiene fallback por polling (el stream-json siempre emite);
   si un CLI futuro dejara de emitir eventos, el texto final igual llega por
   `result` del stdout.
- `MAX_PARALLEL_CLAUDE=1` por cortesía con la cuenta Enterprise; subilo por
   env si querés más.
- Insights cuenta Claude en el donut de ejecutores (color naranja #f97316).
- Hooks registrados también en `~/.claude/settings.json` (backup
   `settings.json.backup-bridge-2026-09-07`); `--remove` los quita.
