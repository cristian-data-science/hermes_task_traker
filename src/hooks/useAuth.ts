import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";

/**
 * Hook de autenticación.
 *
 * `api.auth.isAuthenticated` devuelve:
 *   - undefined  → cargando
 *   - false      → sin sesión
 *   - true       → sesión activa
 */
export function useAuth() {
  const { signIn, signOut } = useAuthActions();
  const viewer = useQuery(api.auth.isAuthenticated, {});

  const isLoading = viewer === undefined;
  const isAuthenticated = viewer === true;

  return {
    isLoading,
    isAuthenticated,
    signIn,
    signOut,
  };
}
