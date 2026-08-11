/**
 * Agrupación del tablero por proyecto.
 *
 * ===== LA REGLA =====
 * La profundidad que varía es la de las TAREAS, no la de la estructura:
 * space → folder → list es siempre igual de profundo, mientras que debajo de
 * una list puede haber 0, 1 o 4 tareas contenedoras (raíz, fases, tarea padre)
 * según el proyecto.
 *
 * Por eso se agrupa por la parte fija —la **list**, que es lo que ClickUp y la
 * config del proyecto ya llaman "proyecto"— y la parte variable se comprime en
 * el subtítulo de la tarjeta. Así la cantidad de grupos no depende de lo
 * profundo que sea cada proyecto.
 *
 * El subtítulo muestra a lo sumo dos segmentos: el primero y el último, con
 * elipsis en el medio. El primero ubica (qué fase) y el último precisa (de qué
 * cuelga); lo del medio casi nunca aporta y sí ocupa el ancho de una columna.
 */

/** Lo mínimo que necesita una tarea para ser agrupada. */
export interface GroupableTask {
  clickupId?: string;
  clickupListId?: string;
  clickupPath?: {
    folderName?: string;
    listName?: string;
    ancestors?: string[];
  };
}

/** Grupo al que pertenece una tarea. */
export interface TaskGroup {
  /** Clave estable para agrupar y para el `key` de React. */
  key: string;
  /** Etiqueta del encabezado ("Ley de Datos", "Sueltas"). */
  label: string;
  /** true para Mesa Técnica y tareas locales: van siempre al final. */
  isLoose: boolean;
}

/**
 * Grupo de descarte: tareas locales (sin ClickUp) y sincronizadas cuya
 * ubicación todavía no se resolvió. Mesa Técnica NO cae acá: es una list real
 * y se muestra con su nombre.
 */
export const LOOSE_GROUP: TaskGroup = {
  key: "__sueltas__",
  label: "Sueltas",
  isLoose: true,
};

export interface GroupOptions {
  /** listId de Mesa Técnica: sus tareas cuentan como sueltas. */
  mesaListId?: string;
  /**
   * Nombres de list que aparecen en más de un folder. Solo esos se prefijan
   * con el folder, para no repetir "Proyectos Internos ›" en todos lados.
   */
  ambiguousListNames?: Set<string>;
}

/**
 * Devuelve el grupo de una tarea.
 *
 * ===== QUIÉN MANDA: LA RUTA RESUELTA, NO EL DESTINO ELEGIDO =====
 * Hay dos datos que dicen dónde vive una tarea y NO son lo mismo:
 *
 *  - `clickupPath` es la ubicación REAL, leída de ClickUp por el backfill.
 *  - `clickupListId` es el destino que se eligió en el selector al crearla
 *    desde Hermes. Es una intención local, y queda congelada: si después la
 *    tarea se mueve de list en ClickUp, este campo sigue apuntando al destino
 *    viejo para siempre.
 *
 * Antes ganaba `clickupListId`, y eso producía el bug de "Revisar y aplicar
 * mejoras interfaz app ley de datos": creada apuntando a Mesa Técnica y movida
 * después a Ley de Datos, se seguía agrupando en Mesa Técnica aunque ClickUp
 * dijera otra cosa.
 *
 * Peor todavía: la clave del grupo salía de `clickupListId` mientras la
 * etiqueta salía de `clickupPath.listName`. Podían discrepar, y entonces dos
 * proyectos REALMENTE distintos colisionaban bajo una misma clave y se
 * dibujaban bajo el encabezado del primero que apareciera. Por eso ahora la
 * clave y la etiqueta salen siempre del mismo dato: no pueden contradecirse.
 */
export function groupOfTask(
  task: GroupableTask,
  opts: GroupOptions = {},
): TaskGroup {
  // Sin ClickUp (tareas locales, datacef, personal) → sueltas.
  if (!task.clickupId && !task.clickupListId) return LOOSE_GROUP;

  const listName = task.clickupPath?.listName?.trim();
  const folderName = task.clickupPath?.folderName?.trim();

  // 1) Ruta resuelta = la verdad. Manda sobre cualquier intención local.
  if (listName) {
    const ambiguous = opts.ambiguousListNames?.has(listName) ?? false;
    const label =
      ambiguous && folderName ? `${folderName} · ${listName}` : listName;
    return {
      // Se incluye el folder en la clave (aunque no siempre en la etiqueta)
      // para que dos lists homónimas en folders distintos sigan siendo grupos
      // distintos, que era la razón original de usar el listId.
      key: `path:${folderName ?? ""}/${listName}`,
      label,
      isLoose: false,
    };
  }

  // 2) Sin ruta resuelta todavía: se cae a la intención local como respaldo.
  //
  // Mesa Técnica es una list de verdad, no un cajón de sobras, así que tiene
  // grupo propio en vez de mezclarse con las sueltas. Mientras el backfill no
  // corra, sus tareas pueden quedar repartidas entre este grupo y el de arriba
  // (mismo proyecto, claves distintas). Es transitorio y se arregla solo al
  // resolver ubicaciones desde el menú del tablero.
  if (opts.mesaListId && task.clickupListId === opts.mesaListId) {
    return {
      key: `list:${opts.mesaListId}`,
      label: "Mesa Técnica",
      isLoose: false,
    };
  }

  // 3) Sincronizada, sin ruta y sin destino conocido: no inventamos un grupo.
  return LOOSE_GROUP;
}

/**
 * Subtítulo de la tarjeta: dónde cuelga dentro del proyecto.
 * Devuelve "" cuando la tarea está suelta en la list (sin ancestros).
 */
export function subtitleOfTask(task: GroupableTask): string {
  const listName = task.clickupPath?.listName?.trim();
  const raw = task.clickupPath?.ancestors ?? [];

  const parts = raw
    .map((s) => s?.trim())
    .filter((s): s is string => !!s)
    // Es habitual que la tarea raíz se llame igual que su list
    // ("Ley de Datos › Ley de Datos"): esa repetición no aporta nada.
    .filter((s) => s !== listName)
    // Y colapsar repetidos consecutivos, por si la jerarquía los tiene.
    .filter((s, i, arr) => i === 0 || s !== arr[i - 1]);

  if (parts.length === 0) return "";
  if (parts.length <= 2) return parts.join(" › ");
  return `${parts[0]} › … › ${parts[parts.length - 1]}`;
}

/**
 * Detecta qué nombres de list están repetidos en folders distintos. Solo esos
 * necesitan el prefijo del folder para distinguirse.
 */
export function findAmbiguousListNames(tasks: GroupableTask[]): Set<string> {
  const foldersByList = new Map<string, Set<string>>();
  for (const t of tasks) {
    const listName = t.clickupPath?.listName?.trim();
    if (!listName) continue;
    const folder = t.clickupPath?.folderName?.trim() ?? "";
    const set = foldersByList.get(listName) ?? new Set<string>();
    set.add(folder);
    foldersByList.set(listName, set);
  }
  const ambiguous = new Set<string>();
  for (const [listName, folders] of foldersByList) {
    if (folders.size > 1) ambiguous.add(listName);
  }
  return ambiguous;
}

/**
 * Orden de los grupos dentro de una columna: manda la tarjeta que el usuario
 * tenga más arriba en cada grupo, así su drag sigue definiendo el orden y no
 * inventamos uno nuevo. "Sueltas" siempre al final.
 *
 * Devuelve un rank por clave de grupo, para ordenar sin re-agrupar.
 */
export function groupRanks(
  orderedTasks: GroupableTask[],
  opts: GroupOptions = {},
): Map<string, number> {
  const ranks = new Map<string, number>();
  let next = 0;
  for (const t of orderedTasks) {
    const g = groupOfTask(t, opts);
    if (g.isLoose) continue; // se fuerza al final más abajo
    if (!ranks.has(g.key)) ranks.set(g.key, next++);
  }
  // Sueltas al final, siempre.
  ranks.set(LOOSE_GROUP.key, Number.MAX_SAFE_INTEGER);
  return ranks;
}
