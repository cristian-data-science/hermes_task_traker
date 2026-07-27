import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";

/**
 * Hook que devuelve los conteos de sub-tareas {done, total} por taskId.
 * Usa una sola query agregada para evitar N peticiones.
 */
export function useSubtaskCounts(): Record<
  string,
  { done: number; total: number }
>;
export function useSubtaskCounts(
  _tasks?: unknown,
): Record<string, { done: number; total: number }>;
export function useSubtaskCounts(_tasks?: unknown) {
  const counts = useQuery(api.subtasks.allCounts, {});
  // Mientras carga, devolvemos objeto vacío
  return (counts ?? {}) as Record<string, { done: number; total: number }>;
}
