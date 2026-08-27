/**
 * Genera `tests-e2e/.auth/prod.json` (storageState de Playwright) con una
 * sesión REAL de producción, replicando el login RSA del navegador:
 * challenge → firma RSASSA-PKCS1-SHA256 con keys/rsa_key.p8 → signInWithRsa.
 *
 * Uso: node scripts/gen-session.mjs [--origin http://otra-url]
 * La clave privada NUNCA sale de esta máquina; solo se envía la firma.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const EXTRA_ORIGIN = process.argv.includes("--origin")
  ? process.argv[process.argv.indexOf("--origin") + 1]
  : null;

const ORIGINS = [
  "http://localhost:4173",
  ...(EXTRA_ORIGIN ? [EXTRA_ORIGIN] : []),
];

const CONVEX_CLI = path.resolve("node_modules/convex/bin/main.js");

/**
 * Corre una función de Convex SIN shell (argv limpio, JSON intacto incluso
 * en Windows, donde execSync usa cmd.exe y destruye las comillas).
 */
function convexRun(fn, argsJson) {
  const args = [
    CONVEX_CLI,
    "run",
    fn,
    "--prod",
    ...(argsJson ? [argsJson] : []),
  ];
  const out = execFileSync(process.execPath, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const start = out.indexOf("{");
  return JSON.parse(out.slice(start));
}

// 1) Challenge de un solo uso.
const { challenge } = convexRun("auth:createChallenge");

// 2) Firma RSASSA-PKCS1-v1_5 + SHA-256 sobre el challenge (string UTF-8).
const keyPem = fs.readFileSync(path.resolve("keys/rsa_key.p8"), "utf8");
const privateKey = crypto.createPrivateKey({
  key: keyPem,
  format: "pem",
  type: "pkcs8",
});
const signer = crypto.createSign("RSA-SHA256");
signer.update(challenge);
signer.end();
const signature = signer.sign(privateKey, "base64");

// 3) Canjear la firma por un token de sesión.
const { token } = convexRun(
  "auth:signInWithRsa",
  JSON.stringify({ challenge, signature }),
);

// 4) StorageState para Playwright (token + tema matrix en cada origin).
const storageState = {
  cookies: [],
  origins: ORIGINS.map((origin) => ({
    origin,
    localStorage: [
      { name: "hermes-session-token", value: token },
      { name: "cat-theme", value: "matrix" },
    ],
  })),
};

fs.mkdirSync(path.resolve("tests-e2e/.auth"), { recursive: true });
fs.writeFileSync(
  path.resolve("tests-e2e/.auth/prod.json"),
  JSON.stringify(storageState, null, 2),
);
console.log(
  `✓ Sesión escrita en tests-e2e/.auth/prod.json para origins: ${ORIGINS.join(", ")}`,
);
