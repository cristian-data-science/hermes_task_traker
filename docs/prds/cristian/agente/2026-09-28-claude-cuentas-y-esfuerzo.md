# PRD: cuentas de Claude Code (Enterprise / Personal) + Opus 5.5 con esfuerzo medio/alto

| Campo | Valor |
|---|---|
| Fecha | 2026-09-28 |
| Dueño | Cristian |
| Módulo | agente (puente + Convex + modal de tarea) |
| Estado | hecho (directo en master a pedido de Cris) |

## 1. Problema

1. Cris tiene dos cuentas de Claude Code (Enterprise de Patagonia y una
   personal). El agente corre siempre con lo que haya en `~/.claude` y la app
   no muestra con cuál: no hay forma de revisarlo antes de lanzar ni de
   saber después desde qué cuenta corrió.
2. Cambiar de cuenta implica `logout`/`login`, lo que pierde la otra sesión.
3. "Opus 5.5 High" no corría Opus 5.5: `claudeModelFlags` descartaba la
   versión (`--model opus`) y el CLI 2.1.263 resolvía `opus` → `claude-opus-5`
   (verificado en `modelUsage`). Además solo había esfuerzo "high".

## 2. Para quién

> **Cris**, que delega tareas a Claude Code y necesita elegir con qué cuenta
> y con qué modelo/esfuerzo corren, sin sorpresas.

## 3. Solución

- **Una carpeta de config por cuenta** (`CLAUDE_CONFIG_DIR`): Enterprise =
  `~/.claude` (sin env, igual que antes), Personal = `~/.claude-personal`.
  Cada una tiene su login → ambas quedan logueadas a la vez.
- **Puente** (`claude-accounts.mjs`): `claude auth status --json` por cuenta,
  publicado a Convex (`agent:syncClaudeAccounts`) al arrancar, cada 5 min y a
  pedido de la app. Login rápido: abre una consola visible con
  `claude auth login` para esa cuenta.
- **Antes de lanzar**: el dispatcher verifica la sesión de la cuenta de la
  tarea (o la default global). Sin sesión → pregunta `[sin-sesion]`, sin
  spawn. Con sesión → env `CLAUDE_CONFIG_DIR`, primera actividad
  "Ejecutando con Claude <cuenta> · <email> · <org>", y la corrida guarda
  `account`/`accountEmail` (chip "Cuenta: …" en el panel de corridas).
- **Modal**: dimensión "Cuenta" (solo Claude Code) con estado en vivo,
  "Hacer default", "Verificar" e "Iniciar sesión".
- **Modelo + esfuerzo**: el catálogo lista modelos base (Sonnet 5, Opus 5,
  Opus 5.5) y el modal suma "Esfuerzo medio | alto". El id sigue siendo
  `claude/<modelo>-<versión>-<esfuerzo>`; el adaptador ahora pasa la
  versión: `--model claude-opus-5-5 --effort medium`.

## 4. Alcance

- No se toca ZCode.
- Sin migración: `claudeAccount`, `account` y `accountEmail` son opcionales.
- Resume entre cuentas: si Cris cambia la cuenta de una tarea con sesión, el
  JSONL se copia a la carpeta de la cuenta nueva antes de `--resume`.

## 5. Casos de prueba

1. Modal → Claude Code → "Cuenta" muestra Enterprise en verde con email/org.
2. Personal sin sesión → "Iniciar sesión" abre la consola; tras el login
   queda en verde en ≤10 s y Enterprise sigue logueada.
3. Tarea con Personal sin sesión → pregunta `[sin-sesion]`, no hay spawn.
4. Tarea con Opus 5.5 + esfuerzo medio → spawn con
   `--model claude-opus-5-5 --effort medium` y `CLAUDE_CONFIG_DIR` de la cuenta.
5. Tareas viejas (`claude/opus-5-high`, `claude/sonnet-5-high`) siguen
   corriendo (`claude-opus-5` / `claude-sonnet-5`, verificados en 2.1.263).

## 6. Criterios de aceptación

- [x] `tsc -b && vite build` pasa.
- [x] `node --check` de los módulos del puente pasa.
- [x] `claudeModelFlags` mapea versión → id completo (tabla de casos).
- [x] `claude auth status` por cuenta detecta Enterprise logueada y Personal sin sesión.
- [x] CLI actualizado a 2.1.284: Opus 5.5 verificado (`modelUsage` = claude-opus-5-5).
- [ ] Deploy de Convex a producción + reinicio del puente.
