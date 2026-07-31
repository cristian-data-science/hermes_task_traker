/**
 * Criptografía RSA del lado del cliente (Web Crypto API).
 *
 * El login funciona por challenge-response:
 *  1. El backend emite un `challenge` (nonce).
 *  2. Importamos la CLAVE PRIVADA del archivo .p8 arrastrado por el usuario.
 *  3. Firmamos el challenge con RSASSA-PKCS1-v1_5 + SHA-256.
 *  4. Enviamos solo la firma al servidor; la clave privada NUNCA sale del navegador.
 *
 * El formato .p8 (PKCS#8) es el que produce `openssl genpkey`/`openssl pkcs8`:
 *  -----BEGIN PRIVATE KEY-----  (o ENCRYPTED PRIVATE KEY, que no aceptamos).
 */

const RSA_ALGO: RsaHashedImportParams = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
};

/** Convierte un ArrayBuffer → base64 (sin usar btoa, que falla en strings largos). */
export function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Lee el archivo .p8 y firma el challenge con la clave privada que contiene.
 *
 * @param file        el .p8 arrastrado por el usuario.
 * @param challenge   nonce hexadecimal emitido por el backend.
 * @returns           la firma en base64.
 * @throws            si el archivo no es una clave privada PKCS#8 válida.
 */
export async function signChallenge(
  file: File,
  challenge: string,
): Promise<string> {
  const pem = await file.text();

  // Extraer el DER base64 del PEM (entre las cabeceras BEGIN/END PRIVATE KEY).
  // Aceptamos "PRIVATE KEY" (PKCS#8). Rechazamos "ENCRYPTED PRIVATE KEY".
  const encryptedMatch = /-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(pem);
  if (encryptedMatch) {
    throw new Error(
      "La clave está cifrada. Genera una sin contraseña (openssl pkcs8 -nocrypt).",
    );
  }

  const b64Match = pem.match(
    /-----BEGIN PRIVATE KEY-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END PRIVATE KEY-----/,
  );
  if (!b64Match) {
    throw new Error(
      "Archivo inválido: se esperaba una clave privada PKCS#8 (.p8).",
    );
  }

  const derBase64 = b64Match[1].replace(/\s+/g, "");
  const derBytes = Uint8Array.from(atob(derBase64), (c) => c.charCodeAt(0));

  // Importar la clave: no extraíble, solo para firmar.
  const key = await crypto.subtle.importKey("pkcs8", derBytes, RSA_ALGO, false, [
    "sign",
  ]);

  // Firmar el challenge (codificado como UTF-8).
  const data = new TextEncoder().encode(challenge);
  const signature = await crypto.subtle.sign(RSA_ALGO, key, data);

  return bufferToBase64(signature);
}
