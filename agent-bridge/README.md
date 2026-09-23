# agent-bridge — el puente Hermes Task Tracker ⇄ agentes de código

Daemon local que convierte la app web en centro de mando: las tareas con
ejecutor **ZCode** o **Claude Code** se despachan a los pocos segundos a una
sesión headless del agente en la carpeta correcta, con contexto empaquetado,
modelo y autonomía elegidos, y el resultado vuelve a la tarea (estado +
resumen + evidencia). Las notificaciones llegan por **WhatsApp vía Hermes**
(`hermes send`, sin LLM).

El contrato completo (ciclo de vida, autonomía, Git vs archivos) vive en
[`../CONTRATO_AGENTE.md`](../CONTRATO_AGENTE.md).

## Multi-agente (ZCode + Claude Code)

El ejecutor de la tarea decide el motor; cada uno vive en un adaptador de
`agents/` (`zcode.mjs`, `claude.mjs`) con la misma interfaz: spawn headless,
sesión, actividad en vivo, historial y modelos.

| | ZCode | Claude Code |
|---|---|---|
| Spawn | `node zcode.cjs -p … --cwd <carpeta> --mode yolo --json` | `claude.exe -p … --permission-mode bypassPermissions --output-format stream-json --verbose` (cwd = carpeta) |
| Sesión / resume | `sess_…` en `~/.zcode/cli/db/db.sqlite` | uuid; `<uuid>.jsonl` en `~/.claude/projects/<cwd>/` |
| Modelo | swap global del config (exclusivo) | **por flag**: `claude/sonnet-5-high` → `--model sonnet --effort high` (sin swap, paralelizan) |
| Actividad en vivo | tailer del rollout JSONL | eventos stream-json del propio stdout |
| Auth | la que ya tiene el CLI | cuenta Enterprise del CLI (nada que configurar) |

Lane de concurrencia por agente: zcode mantiene la regla del swap (default
paraleliza ×2, modelo distinto exclusivo); claude corre hasta
`MAX_PARALLEL_CLAUDE=2` sin exclusividad — tareas zcode y claude conviven.

Hooks: `register-hooks.mjs` registra los mismos Stop/SessionStart en
`~/.zcode/cli/config.json` Y `~/.claude/settings.json` (no-op salvo corridas
del puente, por `ZCODE_TASK_ID` en el env). Claude además persiste
`session_id` en el stdin del hook — el protocolo ya lo leía.

Chat: `hermesagent://zcode?…` y `hermesagent://claude?…` abren el mismo
`zchat-server` con el adaptador del agente dueño de la sesión (historial del
JSONL, streaming, tools, tracker — ver abajo).

## Arranque

**Puente DEV** (tareas creadas en la app local, deployment `adept-lyrebird-492`):
convive con el de producción — candado y sesión propios por deployment. Sin
él, las tareas de dev quedan "encoladas" para siempre. Se lanza oculto con
`agent-bridge\run-hidden-dev.vbs` (log en `agent-bridge/bridge-dev.log`).
Para que arranque solo al iniciar sesión (opcional):

```powershell
Register-ScheduledTask -TaskName "Agent Bridge (dev)" -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Action (New-ScheduledTaskAction -Execute "wscript.exe" -Argument '"C:\Users\patag\git_provisorio\hermes_task_traker\agent-bridge\run-hidden-dev.vbs"')
```

Ojo: ambos puentes comparten la config global de ZCode; evita correr a la vez
tareas ZCode con modelo no-default en dev y en producción (swap de modelo).

```bash
npm run agent-bridge:dev       # puente contra el deployment DEV (convive con el de producción)
npm run agent-bridge:daemon    # daemon con auto-restart (recomendado)
npm run agent-bridge           # dispatcher a pelo
npm run agent-bridge:hooks     # una sola vez: registra hooks Stop/SessionStart
```

### Auto-arranque al prender el equipo (INSTALADO en el PC de Cris)

- **`agent-bridge/start.cmd`** — lanzador que fija `CONVEX_URL` de producción y
  corre el daemon. Abre una ventana de consola propia (título "Agent Bridge"):
  esa ventana ES el puente — si la cerrás, se detiene hasta el próximo logon.
- **Tarea programada de Windows "Agent Bridge"** — la levanta sola al iniciar
  sesión (`Register-ScheduledTask -AtLogOn`, no requiere admin). Para operarla:
  ```powershell
  Get-ScheduledTask -TaskName "Agent Bridge"        # ¿existe?
  Start-ScheduledTask -TaskName "Agent Bridge"      # arrancar ahora
  Stop-ScheduledTask -TaskName "Agent Bridge"       # detener
  Unregister-ScheduledTask -TaskName "Agent Bridge" # desinstalar
  ```
- **Deployment por defecto: PRODUCCIÓN** (`effervescent-crab-895`) — horneado en
  `config.mjs`, así cualquier arranque sin variables va a la app real. Para dev:
  `CONVEX_URL=https://adept-lyrebird-492.convex.cloud npm run agent-bridge`.

Instancia única por lockfile (`agent-bridge/.bridge.lock`): un segundo dispatcher
no arranca mientras el primero viva. Para auto-arranque al login de Windows:

```
schtasks /create /tn "agent-bridge" /tr "cmd /c cd /d C:\Users\patag\git_provisorio\hermes_task_traker && npm run agent-bridge:daemon" /sc onlogon
```

Variables opcionales (env; defaults ya apuntan a las rutas de esta máquina):

| Var | Default | Qué es |
|---|---|---|
| `CONVEX_URL` | `VITE_CONVEX_URL` de `.env.local` | deployment Convex (mismo que la app) |
| `HERMES_RSA_KEY` | `keys/rsa_key.p8` | clave privada del login del tracker |
| `ZCODE_CLI` | `…/Programs/ZCode/resources/glm/zcode.cjs` | CLI headless |
| `CLAUDE_CLI` | `…/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe` | CLI de Claude Code (npm global) |
| `HERMES_CLI` | `…/hermes/venv/Scripts/hermes.exe` | CLI de Hermes |
| `HERMES_WHATSAPP_TARGET` | `whatsapp:Criss` | target de `hermes send` |
| `AGENT_RUN_TIMEOUT_MS` | `3600000` | mata corridas colgadas |
| `MAX_PARALLEL_CLAUDE` | `2` | corridas Claude simultáneas (tope de cortesía con la cuenta; la cola de la app explica cuándo una tarea espera por esto) |
| `MAX_PARALLEL_DEFAULT` | `2` | corridas ZCode simultáneas con el modelo default (un modelo distinto corre solo por el swap global) |

## Piezas

| Archivo | Rol |
|---|---|
| `agents/index.mjs` | registro de adaptadores: el dispatcher/chat eligen por executor |
| `agents/zcode.mjs` | adaptador ZCode: spawn `--mode yolo --json`, tailer del rollout, swap de modelo |
| `agents/claude.mjs` | adaptador Claude: spawn stream-json, sesión desde `system/init`, historial JSONL, `--model`/`--effort` por corrida |
| `dispatcher.mjs` | daemon: suscripción reactiva a la cola (`agent:agentQueue`), spawn vía adaptador, **lanes de paralelismo por agente** (zcode: corridas al modelo default hasta `MAX_PARALLEL_DEFAULT=2`, modelo distinto exclusivo por swap · claude: hasta `MAX_PARALLEL_CLAUDE`), **actividad en vivo** (tailer zcode / stream claude), watchdog de atascos (`AGENT_STALL_MS`, default 10 min) y post-exit, heartbeat con estado (qué corre + cola), lockfile de instancia única |
| `daemon.mjs` | wrapper con auto-restart (backoff 2s→30s) |
| `report.mjs` | canal del agente: **`--step "paso"`** (checklist en vivo) y `--state <estado> --summary "≤3 líneas"` (final inmediato tras verificar); dispara WhatsApp según el modo de la tarea |
| `prompts.mjs` | prompt empaquetado: datos + reglas del contrato + receta por tipo (incluye patrón de polling para refreshes largos de Power BI) + protocolo de pasos |
| `models.mjs` | catálogo desde `~/.zcode/v2/config.json` (lista viva del plan; GLM-5.3/5.3-Flash/5-Turbo) con fallback al estático + **swap temporal** del `model` del config de ZCode (backup → set → run → restore) |
| `notify.mjs` | WhatsApp vía `hermes send` |
| `hooks/stop-hook.mjs` | watchdog (hook `Stop`): reporta si el agente no lo hizo |
| `hooks/session-hook.mjs` | re-inyecta contexto si abrís la sesión en el desktop |
| `register-hooks.mjs` | registra los hooks globales (backup previo; `--remove` para quitarlos) |

## Chat web con el agente (`zchat-server.mjs` + `zchat-ui/`)

El botón **💬 Chatear con el agente** de la app abre `hermesagent://zcode?…`
(protocolo registrado por `register-protocol.cmd`, handler
`protocol-handler.vbs`), que lanza oculto `zchat-server.mjs` y abre el
navegador en `http://127.0.0.1:4311x/`. Es una conversación REAL con la sesión
de ZCode de la tarea (`zcode -p --resume <sess>`, modo `plan`: responde, no
ejecuta cambios).

**Un solo motor de ejecución: el despachador (v5, 22-sep-2026).** El chat ya
no ejecuta trabajo por su cuenta: el viejo "modo ejecución" corría fuera del
tracker (sin corrida, sin pasos, con tope de 15 min) y dejaba el plan
congelado. El composer ahora tiene dos acciones y cambia según el estado:

| Estado de la tarea | Enter | Ctrl+Enter / botón |
|---|---|---|
| para-revisión, hecho, error, cancelada | **Preguntar** (turno local, solo lectura) | **Encargar trabajo** → `POST /continue` → `agent:continueTask`: la tarea vuelve a la cola y el despachador retoma la MISMA sesión con plan nuevo, pasos, 60 min y WhatsApp |
| pregunta | Preguntar | **Responder al agente** → `agent:answerQuestion` |
| despachada, trabajando | **Redirigir en vivo** → `POST /redirect` → `agent:redirectAgent` (el puente interrumpe y retoma) | — |
| encolada, planificando | espera (observador) | — |

- Candado anti-carrera: si hay una consulta local corriendo al encargar, se
  detiene ANTES de encolar (dos `--resume` sobre la misma sesión se pisan).
- Un mensaje enviado con una consulta en curso queda **en espera** (hasta 3)
  y se pregunta al terminar: ningún texto se pierde en un 409.
- Solo la propia página puede mandar órdenes: los POST exigen Host
  `127.0.0.1|localhost:<puerto>` y Origin coincidente (403 si no).
- Los turnos de consulta de Claude usan el modelo/esfuerzo de la tarea.

**Cómo se ve la respuesta en vivo.** El CLI corre con
`--output-format stream-json` y escribe en stdout un evento NDJSON por token:
`model.streaming` (`reasoning_delta`, `text_delta`, `tool_call`…),
`tool.updated` (inicio y resultado de cada herramienta), `turn.completed`
(respuesta final + tokens). El servidor los traduce a bloques con id y los
empuja al navegador por SSE (`/events`): razonamiento, herramientas (Read,
Bash, MCP…, con estado y salida) y texto aparecen mientras ocurren, en orden.
Verificado en zcode 0.16.5: la DB de sesiones (`~/.zcode/cli/db/db.sqlite`)
se persiste al cerrar cada paso, **no** token a token — por eso la versión
anterior, que la poll-eaba, mostraba todo de golpe al final. La DB queda como
respaldo si el CLI no emite eventos; en ese caso los mensajes del turno se
correlacionan por `anchor.turnId`/`parentID` para no mezclar corridas
concurrentes del desktop sobre la misma sesión.

**Panel de misión en vivo.** El deep link lleva `task=<id>`; con las
credenciales del puente (`auth.mjs`, misma clave RSA) el servidor se suscribe
a Convex (`tasks:get` + `agent:runsByTask`) y muestra plan con paso actual,
pasos reportados, actividad, estado, resumen y pregunta abierta — y se lo
inyecta fresco al agente en cada pregunta (`[CONTEXTO ACTUALIZADO DEL
TRACKER…]`). Sin credenciales cae al snapshot del enlace (`p64/st/ag`).

**Robustez.**
- Instancia única por sesión: si ya hay un servidor para esa sesión, el nuevo
  abre esa pestaña y sale (antes cada clic sumaba un servidor y los pollers de
  todos mezclaban respuestas).
- `/events` con `id:` por evento → el navegador reconecta solo y el servidor
  re-envía lo perdido (`Last-Event-ID`); `/state` devuelve el turno en curso
  completo, así recargar la página a mitad de una respuesta no pierde nada.
- Un turno a la vez (los siguientes esperan en cola), timeout de 15 min por
  consulta, botón **Detener** (`/cancel`); el watchdog de silencio avisa a
  los 5 min y detiene a los 12, y la UI dice que fue automático. Auto-apagado
  a los 30 min sin uso, pero nunca con una pestaña conectada, una corrida
  observada o un turno abierto. Cancelar mata el ÁRBOL de procesos
  (`proc.mjs` → `taskkill /T /F`), con cierre de respaldo si un nieto retiene
  el stdout.
- El texto final autoritativo sale de la DB (fallback: stdout `--json`).

**Temas.** Tres, conmutables en la cabecera y persistidos en el navegador
(`localStorage: zchat-theme`): **Aurora** (oscuro, vidrio, degradados),
**Consola** (terminal neón, monoespaciado) y **Papel** (claro, editorial).

**Probar sin gastar tokens.** `ZCHAT_DEMO=1` simula un turno (razonamiento →
herramientas → respuesta con markdown) sin lanzar el CLI; `ZCHAT_NO_OPEN=1`
no abre el navegador:

```bash
ZCHAT_DEMO=1 ZCHAT_NO_OPEN=1 node agent-bridge/zchat-server.mjs <sess_…> "<carpeta>" - - - <taskId>
```

Otras variables: `ZCHAT_POLL_MS` (200) · `ZCHAT_TURN_TIMEOUT_MS` (900000) ·
`ZCHAT_IDLE_MS` (1800000). Log: `agent-bridge/zchat-server.log`.

## Flujo de una tarea

1. Cris crea la tarea en la web: ejecutor **ZCode** + tipo + carpeta + autonomía + modelo + WhatsApp.
2. El daemon la recibe (WebSocket), valida carpeta en disco y `claimTask` (estado `despachada`, abre corrida).
3. Swap de modelo si corresponde → `zcode -p "<prompt>" --cwd <carpeta> --mode plan|build|edit --json`.
4. El agente trabaja y reporta con `report.mjs` (o el watchdog si no reporta).
5. El daemon vincula el `sessionId` (los seguimientos retoman esa sesión con `--resume`: misma conversación) y notifica por WhatsApp si la tarea lo pide.
6. Cris responde preguntas o aprueba desde la app; la respuesta re-encola con contexto.

## Verificaciones empíricas (31-ago/01-sep-2026, zcode 0.16.5)

- **Modo operativo: `yolo`**. Los modos con permisos (`plan`/`build`/`edit`) no dejan ejecutar Bash en headless (no hay quién apruebe) y el agente no puede llamar a `report.mjs`. Los límites son contractuales (prompt) + timeout de corrida.
- **`--disallowed-tools` con specs `Bash(...)` tumba la herramienta Bash ENTERA** (no solo el patrón) — no se usa hasta que el CLI arregle el matcher. Cuando se arregle: `Bash(git *)` para reportes, `Bash(git push *)` para escenario/supervisado.
- `--max-turns` y `--settings` aparecen en el help pero **no están implementados** (arg unknown).
- **Modelo por corrida**: escribir `model` en `~/.zcode/cli/config.json` con id `<providerKey>/<modelo>` SÍ cambia el modelo de la corrida (probado GLM-5.3). La config de **proyecto** (`zcode.json`/`.zcode/config.json`) NO sirve (no hereda providers → "missing baseURL"). El swap es temporal con backup/restauración (incluso ante crash: al arrancar se restaura desde `.model-backup.json`).
- **Hooks**: el config de ZCode se parsea con schema ESTRICTO — una clave custom en la entrada de hooks invalida TODO el archivo ("Model config is missing"). Formato válido: `hooks: { enabled, events: { Stop: [...], SessionStart: [...] } }` sin claves extra (ver `register-hooks.mjs`).
- Suscripción reactiva con `ConvexClient.onUpdate` (convex 1.42; no existe `.subscribe` en el wrapper).
- `hermes send --to whatsapp:Criss` entrega sin gateway corriendo ni LLM.
- CLI y desktop comparten `~/.zcode/cli/db/db.sqlite`: una corrida despachada se puede abrir después en el desktop.
- **E2E validado** (deployment dev): crear tarea en web → despacho reactivo en segundos → corrida GLM-5.3 con informe real del agente vía `report.mjs` → para-revisión → aprobación → completado, con sesión vinculada para seguimientos.

## Desarrollo vs producción

El daemon apunta al deployment de `CONVEX_URL` (default: el de `.env.local`,
dev). Para operar contra producción (donde está la data real), exporta
`CONVEX_URL=https://<prod>.convex.cloud` tras hacer `npx convex deploy` con las
funciones de la capa agente.
