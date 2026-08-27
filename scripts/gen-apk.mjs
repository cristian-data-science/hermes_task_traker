/**
 * Genera el APK firmado (TWA) de Hermes Task Tracker vía el servicio cloud
 * de PWABuilder (el mismo que usa pwabuilder.com) — sin toolchain Android.
 *
 * Uso: node scripts/gen-apk.mjs
 * Requiere: PWA desplegada (manifest + iconos 200) y salida a android-apk/.
 * Las contraseñas del keystore se generan y guardan en keys/ (gitignored).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const HOST = "https://agenttask-one.vercel.app";

// Contraseñas estables: si ya existe keys/android-signing-info.json, se
// reutilizan para que regeneraciones del APK usen la misma clave.
const INFO_PATH = path.resolve("keys/android-signing-info.json");
fs.mkdirSync(path.resolve("keys"), { recursive: true });
let signingInfo;
if (fs.existsSync(INFO_PATH)) {
  signingInfo = JSON.parse(fs.readFileSync(INFO_PATH, "utf8"));
} else {
  signingInfo = {
    alias: "hermes",
    keyPassword: crypto.randomBytes(18).toString("base64url"),
    storePassword: crypto.randomBytes(18).toString("base64url"),
  };
  fs.writeFileSync(
    INFO_PATH,
    JSON.stringify({ ...signingInfo, generatedAt: new Date().toISOString() }, null, 2),
  );
}

const options = {
  analysisId: null,
  appVersion: "1.0.0",
  appVersionCode: 1,
  backgroundColor: "#010603",
  display: "standalone",
  enableNotifications: true,
  enableSiteSettingsShortcut: true,
  fallbackType: "customtabs",
  host: HOST,
  iconUrl: `${HOST}/pwa-512x512.png`,
  includeSourceCode: false,
  isChromeOSOnly: false,
  launcherName: "Hermes",
  maskableIconUrl: `${HOST}/maskable-icon-512x512.png`,
  name: "Hermes Task Tracker",
  navigationColor: "#010603",
  navigationColorDark: "#010603",
  navigationDividerColor: "#010603",
  navigationDividerColorDark: "#010603",
  orientation: "portrait",
  packageId: "app.vercel.agenttask_one", // segmento Android válido (sin guiones)
  shortcuts: [],
  signing: {
    file: null,
    alias: signingInfo.alias,
    fullName: "Cristian Gutierrez",
    organization: "Hermes Personal",
    organizationalUnit: "Personal",
    countryCode: "AR",
    keyPassword: signingInfo.keyPassword,
    storePassword: signingInfo.storePassword,
  },
  signingMode: "new",
  splashScreenFadeOutDuration: 300,
  startUrl: "/",
  themeColor: "#010603",
  themeColorDark: "#010603",
  webManifestUrl: `${HOST}/manifest.webmanifest`,
  pwaUrl: HOST,
};

console.log(`Generando APK para ${HOST} …`);
const res = await fetch("https://pwabuilder-cloudapk.azurewebsites.net/generateApkZip", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(options),
});

if (!res.ok) {
  const text = await res.text();
  console.error(`✖ HTTP ${res.status}: ${text.slice(0, 600)}`);
  process.exit(1);
}

const buf = Buffer.from(await res.arrayBuffer());
const outZip = path.resolve("android-apk/pwabuilder.zip");
fs.mkdirSync(path.dirname(outZip), { recursive: true });
fs.writeFileSync(outZip, buf);
console.log(`✓ Zip recibido (${(buf.length / 1024 / 1024).toFixed(1)} MB) → ${outZip}`);

// Extraer con python zipfile (multiplataforma).
exec_python_extract(outZip);

function exec_python_extract(zipPath) {
  execFileSync("python", [
    "-c",
    [
      "import zipfile, os, sys",
      `zp = ${JSON.stringify(zipPath)}`,
      "z = zipfile.ZipFile(zp)",
      "print('CONTENIDO:', z.namelist())",
      "z.extractall('android-apk/unzipped')",
      "print('extraido a android-apk/unzipped')",
    ].join("\n"),
  ]);
}
