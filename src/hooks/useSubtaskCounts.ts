import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { useAuth } from "./useAuth";

/**
 * Hook que devuelve los conteos de sub-tareas {done, total} por taskId.
 * Usa una sola query agregada para evitar N peticiones.
 *
 * Requiere el token de sesión (pasado al backend para autorizar la lectura).
 * Si la sesión caduca o es inválida, devuelve un objeto vacío en lugar de
 * propagar el error (el gating de auth se encargará de mostrar el login).
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
  // `counts` es undefined mientras carga o si la query falla (sesión inválida).
  // En cualquier caso tratamos como "sin datos" para no romper la UI.
  return (counts ?? {}) as Record<string, { done: number; total: number }>;
}
