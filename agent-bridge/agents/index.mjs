/**
 * Registro de adaptadores de agentes: el dispatcher y el chat eligen por
 * executor de la tarea. Agregar un agente nuevo = un archivo en agents/ y una
 * entrada acá.
 */
import { zcodeAdapter } from "./zcode.mjs";
import { claudeAdapter } from "./claude.mjs";

export const ADAPTERS = { zcode: zcodeAdapter, claude: claudeAdapter };

/** Adaptador del executor (default zcode: claw/cris no llegan al dispatch). */
export function adapterFor(executor) {
  return ADAPTERS[executor] ?? zcodeAdapter;
}
