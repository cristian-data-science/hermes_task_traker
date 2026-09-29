# Resumen post-implementación: cuentas de Claude Code + Opus 5.5 con esfuerzo

PRD: `docs/prds/cristian/agente/2026-09-28-claude-cuentas-y-esfuerzo.md` · 2026-09-28
(directo en master a pedido de Cris)

## 1. Qué se implementó

- Selector "Cuenta" (Enterprise / Personal) en el modal para Claude Code, con
  estado real del login, "Hacer default", "Verificar" e "Iniciar sesión".
- Verificación de la cuenta antes de cada lanzamiento; sin sesión no hay spawn
  (pregunta `[sin-sesion]`). Cada corrida muestra y guarda desde qué cuenta corrió.
- Selector de esfuerzo (medio / alto) junto al modelo; Opus 5.5 corre de verdad.

## 2. Cómo se implementó

- `agent-bridge/claude-accounts.mjs` (nuevo): registro de cuentas, `claude auth
  status --json`, env `CLAUDE_CONFIG_DIR`, login en consola visible, sesiones
  entre cuentas (copia del JSONL).
- `dispatcher.mjs`: sync de cuentas (arranque, cada 5 min, a pedido vía
  suscripción a `agent:claudeAccountRequest`), verificación previa al claim,
  env por cuenta, actividad "Ejecutando con Claude …".
- `agents/claude.mjs`: `claudeModelFlags` pasa la versión (`claude-opus-5-5`);
  catálogo de modelos base. `zchat-server.mjs`: el chat usa la cuenta de la sesión.
- `register-hooks.mjs`: hooks en el `settings.json` de cada cuenta.
- Convex: `tasks.claudeAccount`, `agentRuns.account/accountEmail`,
  `syncClaudeAccounts`, `listClaudeAccounts`, `setDefaultClaudeAccount`,
  `requestClaudeAccountAction`, `claudeAccountRequest`, `clearClaudeAccountRequest`.
- UI: `AgentDelegationSection` (Cuenta + Esfuerzo), `TaskModal`, `AgentRunsPanel`.

## 3. Por qué es la mejor forma

- `CLAUDE_CONFIG_DIR` aísla login, sesiones y settings por cuenta: ambas quedan
  logueadas y pueden correr en paralelo. Alternativa descartada: intercambiar
  `.credentials.json` — rompe corridas paralelas, pisa la sesión interactiva de
  Cris y pierde los refresh de token.
- Id completo del modelo en vez del alias: un CLI viejo falla con error
  explícito en lugar de cambiar de modelo en silencio.

## 4. Qué probar

1. Modal → Claude Code → "Cuenta": Enterprise en verde con email/org.
2. Personal → "Iniciar sesión" → consola + navegador; queda verde y Enterprise sigue logueada.
3. Tarea con Opus 5.5 + esfuerzo medio → log: `--model claude-opus-5-5 --effort medium`.

## 5. Efectos secundarios y deudas

- Opus 5.5 exige CLI ≥ 2.1.280 (actualizado a 2.1.284 el 2026-09-28).
- Tras el primer login de Personal, correr `npm run agent-bridge:hooks` para
  asegurar los hooks en `~/.claude-personal`.
- No verificado aún: `--resume` de una sesión copiada desde otra cuenta.
