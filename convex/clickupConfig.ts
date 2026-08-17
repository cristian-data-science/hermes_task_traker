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

/** Team (workspace) de ClickUp "Patagonia" — donde viven todas las lists. */
export const CLICKUP_TEAM_ID = "8623032";

/** Space "LATAM Portfolio" (único space del team). Vive aquí todos los folders. */
export const CLICKUP_SPACE_ID = "90142709243";

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
 * Áreas ocultas en la UI (solo visualización). JSON array de area ids, ej:
 * '["datacef","personal"]'. Vacío o ausente = todas visibles. Las áreas
 * ocultas siguen existiendo en la DB y sus tareas se siguen sincronizando;
 * solo desaparecen de los filtros, la vista lista y el TaskModal.
 */
export const SETTINGS_KEY_HIDDEN_AREAS = "ui.hiddenAreas";
/**
 * Suscripciones de ClickUp (inbound persistente). JSON array de nodos
 * suscriptos. Marcar un nodo = "watch": trae sus tareas actuales + mantiene
 * actualizadas las futuras. Desmarcar = deja de seguir.
 */
export const SETTINGS_KEY_SUBSCRIPTIONS = "clickup.subscriptions";

/** Un nodo del workspace suscripto para sincronización inbound. */
export interface ClickupSubscription {
  /** Tipo de nodo: folder (proyecto), list, o task individual. */
  nodeType: "folder" | "list" | "task";
  /** id del nodo en ClickUp. */
  id: string;
  /** Etiqueta legible (nombre del folder/list/tarea). */
  label: string;
}
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
  /**
   * id del nodo padre en ClickUp bajo el que anidar las tareas.
   * undefined = las tareas caen planas en la list (sin anidar).
   */
  parentId?: string;
  /**
   * Override del listId del proyecto. Solo se setea cuando un folder tiene
   * varias lists (ej. CatchUp: Cris / Cesar) y el destino pertenece a una
   * list distinta a la principal del proyecto.
   */
  listId?: string;
}

/** Una list de ClickUp dentro de un folder/proyecto. */
export interface ClickupList {
  id: string;
  name: string;
}

/** Un proyecto configurable de ClickUp (ej. Ley de Datos). */
export interface ClickupProject {
  id: string;
  label: string;
  /** List principal de ClickUp donde viven las tareas de este proyecto. */
  listId: string;
  /**
   * Lists adicionales del mismo folder (ej. CatchUp tiene Cris + Cesar).
   * Si está vacío o ausente, el proyecto tiene una sola list (listId).
   */
  lists?: ClickupList[];
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
 * Resuelve el destino outbound de una tarea: devuelve { listId, parentId? }.
 *
 * Prioridad:
 *   1. parentId seteado y mapeado en config.projects → list del destino/proyecto.
 *   2. parentId seteado sin mapeo → se respeta el listId que eligió el usuario
 *      en el picker (clickupListId); si no hay, Mesa Técnica (ClickUp acepta
 *      parent cross-list dentro del mismo space).
 *   3. Sin parentId pero CON clickupListId → tarea plana (nivel 0) en esa list.
 *      Es el caso "eligió proyecto + plano (sin anidar)" del picker: antes caía
 *      silenciosamente en Mesa Técnica porque esta función ignoraba el listId.
 *   4. Sin parentId ni listId → Mesa Técnica.
 */
export function resolveOutboundDestination(
  config: ClickupConfig,
  clickupParentId: string | undefined,
  clickupListId?: string | undefined,
): { listId: string; parentId: string | undefined } {
  // Normalizar: el picker puede emitir "" al elegir "plano".
  const parentId = clickupParentId ? clickupParentId : undefined;
  const chosenListId = clickupListId ? clickupListId : undefined;

  if (!parentId) {
    // Tarea plana: si el usuario eligió una list explícita, se respeta.
    return {
      listId: chosenListId ?? config.mesaTecnica.listId,
      parentId: undefined,
    };
  }
  for (const project of config.projects) {
    // Buscar el destino cuyo parentId coincide; respetar su listId si lo tiene.
    const dest = project.destinations.find((d) => d.parentId === parentId);
    if (dest) {
      return {
        listId: dest.listId ?? project.listId,
        parentId,
      };
    }
  }
  // Fallback: el parentId no mapea a ningún destino configurado. Usamos la list
  // que eligió el usuario en el picker (o Mesa Técnica) y respetamos el parent;
  // ClickUp acepta parent cross-list dentro del mismo space.
  return {
    listId: chosenListId ?? config.mesaTecnica.listId,
    parentId,
  };
}

// ============================================================
//  Detección de entorno (prod vs dev)
// ============================================================
/**
 * ¿Este deployment es el de producción?
 *
 * De esto depende que el sync outbound escriba en ClickUp: en dev está
 * bloqueado para no ensuciar el workspace compartido.
 *
 * OJO con la historia: antes esto miraba `CONVEX_CLOUD_DEPLOYMENT`, que NO es
 * una variable de sistema de Convex — las únicas garantizadas son
 * `CONVEX_CLOUD_URL` y `CONVEX_SITE_URL`. Como nunca existía, `deployment`
 * quedaba en "" y la app se creía en dev SIEMPRE, también en producción: de
 * ahí el cartel amarillo de "Modo desarrollo" en prod y que el sync real solo
 * funcionara si se prendía el override manual.
 *
 * Ahora la señal es explícita: se setea `HERMES_ENV=production` únicamente en
 * el deployment de producción. Ante la duda se asume dev, que es el lado
 * seguro (no se escribe nada en ClickUp).
 */
export function isProductionDeployment(): boolean {
  // 1) Señal explícita (la recomendada).
  if (process.env.HERMES_ENV === "production") return true;
  // 2) Compatibilidad: por si alguien seteó la variable vieja a mano.
  if ((process.env.CONVEX_CLOUD_DEPLOYMENT ?? "").startsWith("prod:")) {
    return true;
  }
  return false;
}

/** Descripción de por qué se detectó dev/prod, para poder diagnosticarlo en la UI. */
export function envSignalLabel(): string {
  if (process.env.HERMES_ENV === "production") return "HERMES_ENV=production";
  if ((process.env.CONVEX_CLOUD_DEPLOYMENT ?? "").startsWith("prod:")) {
    return "CONVEX_CLOUD_DEPLOYMENT";
  }
  return "sin marca de producción";
}
