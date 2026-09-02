# agent-bridge — el puente Hermes Task Tracker ⇄ ZCode

Daemon local que convierte la app web en centro de mando: las tareas con
ejecutor **ZCode** se despachan a los pocos segundos a una sesión headless de
ZCode en la carpeta correcta, con contexto empaquetado, modelo y autonomía
elegidos, y el resultado vuelve a la tarea (estado + resumen + evidencia).
Las notificaciones llegan por **WhatsApp vía Hermes** (`hermes send`, sin LLM).

El contrato completo (ciclo de vida, autonomía, Git vs archivos) vive en
[`../CONTRATO_AGENTE.md`](../CONTRATO_AGENTE.md).

## Arranque

```bash
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
| `HERMES_CLI` | `…/hermes/venv/Scripts/hermes.exe` | CLI de Hermes |
| `HERMES_WHATSAPP_TARGET` | `whatsapp:Criss` | target de `hermes send` |
| `AGENT_RUN_TIMEOUT_MS` | `3600000` | mata corridas colgadas |

## Piezas

| Archivo | Rol |
|---|---|
| `dispatcher.mjs` | daemon: suscripción reactiva a la cola (`agent:agentQueue`), spawn `zcode -p` con `--cwd` carpeta, **paralelismo seguro** (corridas al modelo default corren hasta `MAX_PARALLEL_DEFAULT=2` en paralelo; modelo distinto al default es exclusivo por el swap), **tailer en vivo** del transcript (actividad visible en la app cada 5 s), watchdog de atascos (`AGENT_STALL_MS`, default 10 min) y post-exit, heartbeat con estado (qué corre + cola), lockfile de instancia única |
| `daemon.mjs` | wrapper con auto-restart (backoff 2s→30s) |
| `report.mjs` | canal del agente: **`--step "paso"`** (checklist en vivo) y `--state <estado> --summary "≤3 líneas"` (final inmediato tras verificar); dispara WhatsApp según el modo de la tarea |
| `prompts.mjs` | prompt empaquetado: datos + reglas del contrato + receta por tipo (incluye patrón de polling para refreshes largos de Power BI) + protocolo de pasos |
| `models.mjs` | catálogo desde `~/.zcode/v2/config.json` (lista viva del plan; GLM-5.3/5.3-Flash/5-Turbo) con fallback al estático + **swap temporal** del `model` del config de ZCode (backup → set → run → restore) |
| `notify.mjs` | WhatsApp vía `hermes send` |
| `hooks/stop-hook.mjs` | watchdog (hook `Stop`): reporta si el agente no lo hizo |
| `hooks/session-hook.mjs` | re-inyecta contexto si abrís la sesión en el desktop |
| `register-hooks.mjs` | registra los hooks globales (backup previo; `--remove` para quitarlos) |

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
