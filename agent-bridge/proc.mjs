/**
 * Utilidades de procesos del puente (despachador y chat).
 *
 * killTree: en Windows `child.kill()` termina SOLO el proceso directo (el
 * CLI). Si el CLI es Node (zcode.cjs), libuv ya cierra a sus hijos al morir
 * (verificado 22-sep); con un binario nativo (claude.exe) o herramientas que
 * se desprenden, los nietos —Bash/PowerShell, apps, servidores MCP— pueden
 * quedar huérfanos y, si heredan el stdout, el `close` no llega nunca.
 * taskkill /T mata el árbol completo; child.kill() queda de respaldo.
 */
import { spawnSync } from "node:child_process";

export function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    try {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
        timeout: 10_000,
      });
    } catch {
      // taskkill no disponible: cae al kill directo
    }
  }
  try {
    child.kill();
  } catch {
    // ya muerto
  }
}
