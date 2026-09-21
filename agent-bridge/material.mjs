/**
 * Material base del modo carpeta customizada (gitStrategy "solo-local").
 *
 * Los adjuntos que Cris eligió en el modal viajan como RUTAS de origen en
 * contextPaths.archivos (nada de bytes por Convex). Al despachar, este módulo
 * los copia DENTRO de la carpeta customizada para que la corrida sea
 * autocontenida: el agente trabaja con sus copias y los originales quedan
 * donde estaban (ej. Descargas).
 *
 * Función pura de fs: sin Convex, sin spawn — testeable con un tempdir.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Copia los archivos a la carpeta (creándola si no existe).
 *
 * Idempotente y NO destructiva: si el destino ya existe (por nombre), se
 * salta — nunca pisa lo que una corrida anterior (o el propio agente) pudo
 * dejar ahí. Re-despachos y resumes no re-copian nada.
 *
 * @returns {{copiados: string[], saltados: string[], fallidos: {origen: string, error: string}[]}}
 */
export function copiarMaterial(folder, archivos) {
  const copiados = [];
  const saltados = [];
  const fallidos = [];
  if (!folder || !Array.isArray(archivos) || archivos.length === 0)
    return { copiados, saltados, fallidos };

  try {
    mkdirSync(folder, { recursive: true });
  } catch (e) {
    fallidos.push({ origen: folder, error: `no se pudo crear la carpeta: ${e.message}` });
    return { copiados, saltados, fallidos };
  }

  for (const origen of archivos) {
    try {
      if (!existsSync(origen)) {
        fallidos.push({ origen, error: "ya no existe en disco" });
        continue;
      }
      const destino = path.join(folder, path.basename(origen));
      if (existsSync(destino)) {
        saltados.push(destino);
        continue;
      }
      copyFileSync(origen, destino);
      copiados.push(destino);
    } catch (e) {
      fallidos.push({ origen, error: e.message });
    }
  }
  return { copiados, saltados, fallidos };
}
