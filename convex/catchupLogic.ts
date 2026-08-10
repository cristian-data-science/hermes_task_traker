/**
 * Lógica pura del ciclo de compromisos del catch-up.
 *
 * ===== POR QUÉ VIVE APARTE =====
 * Estas son las reglas que deciden si una promesa se cumplió, se arrastró o se
 * abandonó — o sea, las que producen los números que le vas a mostrar a tu
 * jefatura. Enterradas dentro de un handler de Convex serían imposibles de
 * probar sin una base de datos: se verificarían mirándolas fijo y esperando.
 *
 * Acá no se importa nada de Convex ni se toca la DB. Entra data, sale un
 * veredicto, y se puede ejercitar con casos límite en segundos.
 */

/** Un compromiso tal como se guardó en un cierre. */
export interface StoredCommitment {
  id: string;
  text: string;
  taskId?: string;
  manualDone?: boolean;
  carryCount?: number;
  rootId?: string;
}

/**
 * Identidad estable de un compromiso a través de sus arrastres.
 *
 * Los cierres nuevos guardan `rootId` explícito. Los anteriores a ese campo se
 * deducen del `id`, que al arrastrarse se construye como `<original>-carry`
 * repetidamente: pelando esos sufijos se recupera el original.
 */
export function rootIdOf(c: { id: string; rootId?: string }): string {
  if (c.rootId) return c.rootId;
  let id = c.id;
  while (id.endsWith("-carry")) id = id.slice(0, -"-carry".length);
  return id;
}

/** Desenlace de una cadena de compromisos. */
export type ChainOutcome = "done" | "open" | "dropped";

export interface ChainFacts {
  /** ¿La cadena sigue apareciendo en el último catch-up cerrado? */
  stillLive: boolean;
  /** ¿La tarea enlazada está completada hoy? */
  taskCompleted: boolean;
  /** ¿Se marcó a mano como cumplido en alguna aparición? */
  manualDone: boolean;
  /** ¿Hay una tarea enlazada que todavía existe en el tablero? */
  taskAlive: boolean;
  /** Estado actual de esa tarea, para el texto explicativo. */
  taskStatus?: string;
}

/**
 * Decide en qué terminó una cadena de compromisos.
 *
 * El caso que importa es `dropped`: un compromiso que deja de aparecer sin
 * haberse cumplido. No falla ruidosamente — simplemente nadie lo vuelve a
 * mencionar. Si la app no lo señalara, sería exactamente el tipo de cosa que
 * se pierde entre semanas y reaparece en la peor conversación posible.
 */
export function classifyChain(f: ChainFacts): {
  outcome: ChainOutcome;
  reason: string;
} {
  // El cumplimiento gana sobre todo lo demás: si la tarea está completada, da
  // igual que además siga listada en el último cierre (pasa cuando cerrás la
  // tarea el mismo día del catch-up, antes de armar la lista nueva).
  if (f.taskCompleted) return { outcome: "done", reason: "Tarea completada" };
  if (f.manualDone) return { outcome: "done", reason: "Marcado como cumplido" };

  if (f.stillLive) {
    return {
      outcome: "open",
      reason: f.taskAlive
        ? `Sigue abierto (${f.taskStatus})`
        : "Sigue abierto, sin tarea enlazada",
    };
  }

  return {
    outcome: "dropped",
    reason: f.taskAlive
      ? `Dejó de aparecer sin cerrarse (la tarea sigue en ${f.taskStatus})`
      : "Dejó de aparecer sin cerrarse",
  };
}

/**
 * Cuenta cuántos compromisos de una semana se cumplieron, mirando qué pasó en
 * el catch-up SIGUIENTE.
 *
 * ===== POR QUÉ NO SE MIRA SOLO EL ESTADO DE HOY =====
 * Preguntar "¿la tarea está completada ahora?" premiaría un compromiso cerrado
 * tres meses tarde como si se hubiera cumplido a tiempo, y la tendencia
 * mostraría una mejora que no ocurrió. La pregunta correcta es qué decidiste
 * vos en el catch-up siguiente:
 *
 *  - volvió arrastrado  → no se cumplió (vos mismo lo dijiste al arrastrarlo);
 *  - desapareció y hay evidencia de cierre → se cumplió;
 *  - desapareció sin evidencia → no cuenta como cumplido.
 *
 * El último caso es deliberadamente conservador: ante la duda, la métrica no
 * se infla. Un número que te favorece cuando no sabe es un número inútil.
 */
export function countFulfilled(
  commitments: StoredCommitment[],
  /** rootIds presentes en el catch-up siguiente (los que se arrastraron). */
  carriedRoots: Set<string>,
  /** ¿Está completada la tarea enlazada a este compromiso? */
  isTaskCompleted: (taskId: string) => boolean,
): number {
  let done = 0;
  for (const c of commitments) {
    if (carriedRoots.has(rootIdOf(c))) continue;
    if (c.manualDone) {
      done++;
      continue;
    }
    if (!c.taskId) continue;
    if (isTaskCompleted(c.taskId)) done++;
  }
  return done;
}
