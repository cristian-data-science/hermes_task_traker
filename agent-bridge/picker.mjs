#!/usr/bin/env node
/**
 * picker — selector NATIVO de carpetas/archivos de Windows para la web.
 *
 *   node picker.mjs <key> <kind>   (kind: folder | files)
 *
 * La web abre hermesagent://pick?kind=…&key=… (protocol-handler.vbs → acá),
 * se muestra el diálogo de toda la vida de Windows y el resultado se publica
 * en Convex (`correos:pickReportar`) con las credenciales del puente; la web
 * lo levanta pollando `correos:pickResultado`. Cancelar el diálogo también
 * se reporta, para que la web no quede esperando.
 *
 * Diálogos: PowerShell + System.Windows.Forms (FolderBrowserDialog para
 * carpeta; OpenFileDialog multiselección para archivos). -STA es obligatorio
 * para diálogos. Las rutas viajan por stdout (una por línea).
 */
import { spawn } from "node:child_process";
import { getToken, m } from "./auth.mjs";

const [key, kind] = process.argv.slice(2);
if (!key || !/^[a-z0-9-]{8,64}$/i.test(key) || !["folder", "files"].includes(kind)) {
  console.error("uso: node picker.mjs <key> <folder|files>");
  process.exit(1);
}

/** Corre el diálogo y devuelve las líneas de stdout (rutas elegidas). */
function dialog() {
  const script =
    kind === "folder"
      ? `Add-Type -AssemblyName System.Windows.Forms | Out-Null
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Elige o crea la carpeta de contexto para el agente'
$d.ShowNewFolderButton = $true
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }`
      : `Add-Type -AssemblyName System.Windows.Forms | Out-Null
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Title = 'Elige los archivos de contexto para el agente'
$d.Multiselect = $true
$d.CheckFileExists = $true
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileNames }`;
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-STA", "-Command", script],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", () => {});
    child.on("error", () => resolve(""));
    child.on("close", () =>
      resolve(
        out
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean),
      ),
    );
  });
}

(async () => {
  let paths = [];
  let cancelado = false;
  try {
    paths = await dialog();
    if (!paths.length) cancelado = true;
  } catch {
    cancelado = true;
  }
  try {
    const sessionToken = await getToken();
    await m("correos:pickReportar", { sessionToken, key, kind, ...(cancelado ? { cancelado: true } : { paths }) });
  } catch (e) {
    console.error(`pickReportar falló: ${e?.message ?? e}`);
    process.exit(1);
  }
  process.exit(0);
})();
