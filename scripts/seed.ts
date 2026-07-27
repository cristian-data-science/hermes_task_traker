/**
 * Script de seed: importa las tareas del snapshot a Convex.
 *
 * Uso:
 *   npm run seed
 *
 * Usa el ConvexHttpClient para invocar la mutation `seed:resetAndSeed`.
 *
 * ⚠️ Borra TODAS las tareas y sub-tareas existentes antes de importar.
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { readFileSync } from "node:fs";
import { SEED_TASKS, summarize } from "./seed-data";

// Resolver la URL de Convex desde .env.local o variable de entorno
let url = process.env.VITE_CONVEX_URL;
if (!url) {
  try {
    const env = readFileSync(".env.local", "utf-8");
    const m = env.match(/VITE_CONVEX_URL=(.+)/);
    if (m) url = m[1].trim();
  } catch {
    /* ignore */
  }
}

if (!url) {
  console.error(
    "❌ No se encontró VITE_CONVEX_URL. Ejecuta `npx convex dev` primero.",
  );
  process.exit(1);
}

console.log("\n📋 Hermes Task Tracker — Seed inicial");
console.log("Deployment:", url);
console.log("Tareas a importar:", summarize(SEED_TASKS));
console.log("\n⏳ Ejecutando resetAndSeed en Convex...\n");

const client = new ConvexHttpClient(url);
try {
  const result = (await client.mutation(api.seed.resetAndSeed, {
    tasks: SEED_TASKS,
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
