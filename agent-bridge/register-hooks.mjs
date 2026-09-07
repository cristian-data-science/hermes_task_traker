#!/usr/bin/env node
/**
 * Registra los hooks del puente en el config GLOBAL de ZCode
 * (~/.zcode/cli/config.json) y de Claude Code (~/.claude/settings.json) —
 * con backup previo e idempotente.
 *
 * Por qué global: el agente corre en OTRAS carpetas (C:\mcp_servers\<Reporte>,
 * repos de git_provisorio), no en este repo; un hook de workspace no lo cubriría.
 * Los scripts son no-op salvo que exista ZCODE_TASK_ID en el env (solo corridas
 * despachadas por el puente), así que las sesiones normales no se tocan.
 *
 * Uso: node agent-bridge/register-hooks.mjs [--remove]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZCODE_CONFIG, CLAUDE_SETTINGS } from "./config.mjs";

const BRIDGE_DIR = path.dirname(fileURLToPath(import.meta.url));
const STOP_HOOK = path.join(BRIDGE_DIR, "hooks", "stop-hook.mjs");
const SESSION_HOOK = path.join(BRIDGE_DIR, "hooks", "session-hook.mjs");

/**
 * OJO: el config de ZCode se parsea con schema ESTRICTO — una clave custom
 * (tipo un tag __bridge) invalida TODO el archivo y zcode lo trata como
 * inexistente ("Model config is missing"). Por eso las entradas se marcan
 * por la ruta del comando (contiene agent-bridge), nunca con claves extra.
 */
function isBridgeEntry(group) {
  try {
    return JSON.stringify(group).includes(BRIDGE_DIR);
  } catch {
    return false;
  }
}

function commandFor(script) {
  // Comillas dobles: la ruta del repo puede tener espacios.
  return `node "${script}"`;
}

function hookEntry(script, timeoutSec) {
  return { hooks: [{ type: "command", command: commandFor(script), timeout: timeoutSec }] };
}

function cleanBridgeHooks(events) {
  const out = {};
  for (const [event, groups] of Object.entries(events ?? {})) {
    const kept = (groups || []).filter((g) => g && !isBridgeEntry(g));
    if (kept.length) out[event] = kept;
  }
  return out;
}

// ===== ZCode (~/.zcode/cli/config.json, formato {enabled, events}) =====

function registerZcode(remove) {
  const raw = fs.readFileSync(ZCODE_CONFIG, "utf8");
  const cfg = JSON.parse(raw);

  const hooks = cfg.hooks ?? {};
  const events = cleanBridgeHooks(hooks.events);

  if (remove) {
    cfg.hooks = { ...hooks, events };
    if (!Object.keys(events).length) delete cfg.hooks.events;
    fs.writeFileSync(ZCODE_CONFIG, JSON.stringify(cfg, null, 2));
    console.log("hooks del puente eliminados del config de ZCode");
    return;
  }

  // Backup con fecha ANTES de tocar.
  const backup = `${ZCODE_CONFIG}.backup-bridge-${new Date().toISOString().slice(0, 10)}`;
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, raw);

  events.Stop = [...(events.Stop ?? []), hookEntry(STOP_HOOK, 120)];
  events.SessionStart = [...(events.SessionStart ?? []), hookEntry(SESSION_HOOK, 30)];

  cfg.hooks = { enabled: true, ...hooks, events };
  fs.writeFileSync(ZCODE_CONFIG, JSON.stringify(cfg, null, 2));
  console.log(`hooks ZCode registrados (backup: ${path.basename(backup)})`);
}

// ===== Claude Code (~/.claude/settings.json, formato {Event: [{matcher, hooks}]}) =====

function registerClaude(remove) {
  let raw = "{}";
  try {
    raw = fs.readFileSync(CLAUDE_SETTINGS, "utf8");
  } catch {
    // sin settings.json → se crea
  }
  const cfg = JSON.parse(raw);
  const events = cleanBridgeHooks(cfg.hooks);

  if (remove) {
    if (Object.keys(events).length) cfg.hooks = events;
    else delete cfg.hooks;
    fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(cfg, null, 2));
    console.log("hooks del puente eliminados del settings de Claude");
    return;
  }

  const backup = `${CLAUDE_SETTINGS}.backup-bridge-${new Date().toISOString().slice(0, 10)}`;
  if (!fs.existsSync(backup) && raw !== "{}") fs.writeFileSync(backup, raw);

  // Claude agrupa con matcher ("" = todos) y exige el campo timeout en segundos.
  const claudeEntry = (script, timeoutSec) => ({
    matcher: "",
    hooks: [{ type: "command", command: commandFor(script), timeout: timeoutSec }],
  });
  events.Stop = [...(events.Stop ?? []), claudeEntry(STOP_HOOK, 120)];
  events.SessionStart = [...(events.SessionStart ?? []), claudeEntry(SESSION_HOOK, 30)];

  cfg.hooks = events;
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(cfg, null, 2));
  console.log(`hooks Claude registrados (backup: ${path.basename(backup)})`);
}

function main() {
  const remove = process.argv.includes("--remove");
  registerZcode(remove);
  try {
    registerClaude(remove);
  } catch (e) {
    console.warn(`hooks Claude: ${e.message} (sigue sin ellos)`);
  }
  console.log(`  Stop         → ${STOP_HOOK}`);
  console.log(`  SessionStart → ${SESSION_HOOK}`);
}

try {
  main();
} catch (err) {
  console.error("no se pudo registrar:", err?.message ?? err);
  process.exit(1);
}
