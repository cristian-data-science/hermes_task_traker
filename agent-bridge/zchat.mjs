#!/usr/bin/env node
/**
 * zchat — chat interactivo EN TERMINAL con la sesión de ZCode de una tarea.
 *
 *   node zchat.mjs <sessionId> <workspacePath>
 *
 * El TUI interactivo del CLI no puede correr standalone (importa @zcode/tui,
 * un paquete que solo existe compilado dentro del app.asar del desktop), y el
 * desktop no tiene deep-link de sesiones. Lo que SÍ funciona (verificado) es
 * `zcode -p "<pregunta>" --resume <sess>`: cada corrida RETOMA la sesión y le
 * agrega el turno — así que un loop de pregunta→respuesta es un chat real con
 * toda la memoria del agente, turnos acumulados incluidos.
 *
 * Modo plan: el agente responde y planifica, pero no ejecuta ediciones — es
 * un chat de discusión sobre lo hecho, no una nueva corrida de trabajo.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";

const ZCODE_CLI =
  process.env.ZCODE_CLI ||
  path.join(
    os.homedir(),
    "AppData",
    "Local",
    "Programs",
    "ZCode",
    "resources",
    "glm",
    "zcode.cjs",
  );

const [sessionId, workspacePath] = process.argv.slice(2);
if (!sessionId || !workspacePath) {
  console.error("uso: node zchat.mjs <sessionId> <workspacePath>");
  process.exit(1);
}
if (!existsSync(ZCODE_CLI)) {
  console.error(`No encuentro el CLI de ZCode: ${ZCODE_CLI}`);
  process.exit(1);
}
// La sesión viva en la DB (read-only, no molesta al desktop abierto).
let sessionTitle = "";
try {
  const db = new DatabaseSync(
    path.join(os.homedir(), ".zcode", "cli", "db", "db.sqlite"),
    { readOnly: true },
  );
  const row = db
    .prepare("SELECT title FROM session WHERE id = ?")
    .get(sessionId);
  db.close();
  sessionTitle = row?.title ?? "";
} catch {
  /* sin título, seguimos */
}

console.log("─".repeat(64));
console.log(`💬 Chat con la sesión del agente${sessionTitle ? `: "${sessionTitle}"` : ""}`);
console.log(`   Carpeta: ${workspacePath}`);
console.log(`   Sesión:  ${sessionId}`);
console.log("   El agente tiene TODO el contexto de lo que hizo.");
console.log("   Comandos: /salir para terminar.");
console.log("─".repeat(64));

const rl = createInterface({ input: process.stdin, output: process.stdout });
let stdinAbierto = true;
rl.on("close", () => {
  stdinAbierto = false;
});

while (stdinAbierto) {
  let question;
  try {
    question = (await rl.question("\n🧑 vos > ")).trim();
  } catch {
    break; // stdin cerrado (EOF / terminal cerrada)
  }
  if (!question) continue;
  if (question === "/salir" || question === "/exit" || question === "/quit") {
    console.log("👋 chau (la conversación queda guardada en la sesión).");
    break;
  }
  console.log("\n🤖 agente >");
  await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        ZCODE_CLI,
        "-p",
        `Consulta de Cris sobre el trabajo ya entregado (solo respondé; no ejecutes cambios): ${question}`,
        "--resume",
        sessionId,
        "--cwd",
        workspacePath,
        "--mode",
        "plan",
      ],
      { stdio: ["ignore", "inherit", "inherit"], windowsHide: true },
    );
    child.on("error", (e) => console.error("falló el CLI:", e.message));
    child.on("close", resolve);
  });
}
rl.close();
