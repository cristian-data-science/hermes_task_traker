/**
 * Script de seed: importa las tareas del snapshot a Convex.
 *
 * Uso:
 *   npm run seed
 *
 * Usa el ConvexHttpClient para invocar la mutation `seed:resetAndSeed`.
 *
 * 🔒 Requiere HERMES_ADMIN_TOKEN (configurado como secreto en Convex y también
 *    en .env.local para uso local). Sin él, la mutation destructiva se rechaza.
 *
 * ⚠️ Borra TODAS las tareas/sub-tareas existentes antes de importar.
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { readFileSync } from "node:fs";
import { SEED_TASKS, summarize } from "./seed-data";

// Leer .env.local una sola vez para extraer VITE_CONVEX_URL y HERMES_ADMIN_TOKEN
function readEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const text = readFileSync(".env.local", "utf-8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch {
    /* ignore */
  }
  return out;
}

const envLocal = readEnvLocal();
const url = process.env.VITE_CONVEX_URL ?? envLocal.VITE_CONVEX_URL;
const adminToken =
  process.env.HERMES_ADMIN_TOKEN ?? envLocal.HERMES_ADMIN_TOKEN;

if (!url) {
  console.error(
    "❌ No se encontró VITE_CONVEX_URL. Ejecuta `npx convex dev` primero.",
  );
  process.exit(1);
}
if (!adminToken) {
  console.error(
    "❌ No se encontró HERMES_ADMIN_TOKEN.\n" +
      "   Añádelo a .env.local y como secreto en Convex:\n" +
      "   npx convex env set HERMES_ADMIN_TOKEN <tu-token>",
  );
  process.exit(1);
}

console.log("\n📋 Hermes Task Tracker — Seed inicial");
console.log("Deployment:", url);
console.log("Tareas a importar:", summarize(SEED_TASKS));
console.log("\n⏳ Ejecutando resetAndSeed en Convex...\n");

// Asegurar que todas las tareas tengan executor (por defecto "cris")
const tasks = SEED_TASKS.map((t) => ({
  ...t,
  executor: t.executor ?? ("cris" as const),
}));

const client = new ConvexHttpClient(url);
try {
  const result = (await client.mutation(api.seed.resetAndSeed, {
    adminToken,
    tasks,
  })) as { createdTasks: number; createdSubtasks: number };

  console.log("✅ Seed completado:");
  console.log("   - Tareas creadas:", result.createdTasks);
  console.log("   - Sub-tareas creadas:", result.createdSubtasks);
  console.log("\n🎉 Abre la app y verás tus tareas cargadas.\n");
} catch (err) {
  console.error("\n❌ Error al ejecutar el seed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
