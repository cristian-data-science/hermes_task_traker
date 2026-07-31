import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { useAuth } from "./useAuth";

/**
 * Hook que devuelve los conteos de sub-tareas {done, total} por taskId.
 * Usa una sola query agregada para evitar N peticiones.
 *
 * Requiere el token de sesión (pasado al backend para autorizar la lectura).
 */
export function useSubtaskCounts(): Record<
  string,
  { done: number; total: number }
>;
export function useSubtaskCounts(
  _tasks?: unknown,
): Record<string, { done: number; total: number }>;
export function useSubtaskCounts(_tasks?: unknown) {
  const { token } = useAuth();
  const counts = useQuery(
    api.subtasks.allCounts,
    token ? { sessionToken: token } : "skip",
  );
  // Mientras carga, devolvemos objeto vacío
  return (counts ?? {}) as Record<string, { done: number; total: number }>;
}
