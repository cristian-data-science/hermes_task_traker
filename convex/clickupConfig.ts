/**
 * Configuración de la integración ClickUp (solo área `patagonia`).
 *
 * Toda la configuración de mapeo vive en la tabla `settings` como un JSON bajo
 * la clave `clickup.config`, y un booleano de habilitado bajo `clickup.enabled`.
 * Esto permite añadir/quitar proyectos o cambiar destinos sin tocar código.
 *
 * Jerarquía de ClickUp que mapeamos (team Patagonia 8623032):
 *   - Mesa Técnica → List 901418067371 (tareas sueltas)
 *   - Ley de Datos → List 901412131396, tarea raíz 86b67yvdu, 3 ramas:
 *       * Levantamiento y alcance   (alcance)        parentId 86b67yvgr
 *       * Desarrollo / App Web      (desarrollo)     parentId 86b67yvhh
 *       * Despliegue y cumplimiento (puesta-en-marcha) parentId 86bb2xvgr
 */

/** Mi user id en ClickUp (para `assignees` cuando executor = cris). */
export const CLICKUP_USER_ID = "156001186";

/** Tipo de estado de Hermes (reexportado para compartir entre módulos). */
export type HermesStatus =
  | "urgente"
  | "pendiente"
  | "en-curso"
  | "standby"
  | "programado"
  | "completado";

/** Claves de settings bajo las que se guarda la config de ClickUp. */
export const SETTINGS_KEY_CONFIG = "clickup.config";
export const SETTINGS_KEY_ENABLED = "clickup.enabled";
export const SETTINGS_KEY_LAST_SYNC = "clickup.lastSyncAt";
export const SETTINGS_KEY_LAST_INBOUND = "clickup.lastInboundAt";
/**
 * Override de prueba: si vale "true", el sync outbound corre AUN en dev.
 * Sirve para validar la integración contra ClickUp real desde local sin
 * deployar a prod. Default off (en dev el sync está bloqueado por seguridad).
 */
export const SETTINGS_KEY_FORCE_SYNC_DEV = "clickup.forceSyncDev";

/** Un destino dentro de un proyecto (rama bajo la que anidar la tarea). */
export interface ClickupDestination {
  id: string;
  label: string;
  /** id del nodo padre en ClickUp bajo el que anidar las tareas. */
  parentId: string;
}

/** Un proyecto configurable de ClickUp (ej. Ley de Datos). */
export interface ClickupProject {
  id: string;
  label: string;
  /** List de ClickUp donde viven las tareas de este proyecto. */
  listId: string;
  /** Si true, el botón de sync reversa escanea este proyecto. */
  inbound: boolean;
  destinations: ClickupDestination[];
}

/** Configuración completa de ClickUp, serializada en settings. */
export interface ClickupConfig {
  /** List de Mesa Técnica (tareas sueltas). */
  mesaTecnica: { listId: string; inbound: boolean };
  projects: ClickupProject[];
}

/** Config por defecto (IDs verificados en fase 0). Sirve como seed. */
export const DEFAULT_CLICKUP_CONFIG: ClickupConfig = {
  mesaTecnica: { listId: "901418067371", inbound: true },
  projects: [
    {
      id: "ley-de-datos",
      label: "Ley de Datos",
      listId: "901412131396",
      inbound: true,
      destinations: [
        {
          id: "alcance",
          label: "Levantamiento y alcance",
          parentId: "86b67yvgr",
        },
        {
          id: "desarrollo",
          label: "Desarrollo / App Web",
          parentId: "86b67yvhh",
        },
        {
          id: "puesta-en-marcha",
          label: "Despliegue y cumplimiento",
          parentId: "86bb2xvgr",
        },
      ],
    },
  ],
};

/**
 * Parsea y valida la config guardada en settings. Si falta o está corrupta,
 * devuelve la config por defecto.
 */
export function parseClickupConfig(raw: string | undefined): ClickupConfig {
  if (!raw) return DEFAULT_CLICKUP_CONFIG;
  try {
    const parsed = JSON.parse(raw) as ClickupConfig;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.mesaTecnica &&
      Array.isArray(parsed.projects)
    ) {
      return parsed;
    }
  } catch {
    // JSON inválido → default
  }
  return DEFAULT_CLICKUP_CONFIG;
}

/**
 * Resuelve el destino outbound de una tarea:
 * devuelve { listId, parentId? } según clickupParentId.
 *   - parentId vacío → Mesa Técnica (listId de mesa, sin parent).
 *   - parentId seteado → busca en los proyectos cuál contiene ese parentId y
 *     devuelve el listId del proyecto + el parentId.
 * Si no encuentra mapeo, cae a Mesa Técnica como fallback seguro.
 */
export function resolveOutboundDestination(
  config: ClickupConfig,
  clickupParentId: string | undefined,
): { listId: string; parentId: string | undefined } {
  if (!clickupParentId) {
    return { listId: config.mesaTecnica.listId, parentId: undefined };
  }
  for (const project of config.projects) {
    if (project.destinations.some((d) => d.parentId === clickupParentId)) {
      return { listId: project.listId, parentId: clickupParentId };
    }
  }
  // Fallback: si el parentId no mapea a ningún destino conocido, usamos la
  // list de Mesa Técnica pero respetamos el parent (ClickUp acepta parent
  // cross-list en el mismo space).
  return { listId: config.mesaTecnica.listId, parentId: clickupParentId };
}
