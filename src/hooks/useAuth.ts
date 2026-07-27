import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";

/**
 * Hook de autenticación.
 * Expone el usuario actual, isLoading y acciones de login/logout.
 */
export function useAuth() {
  const { signIn, signOut } = useAuthActions();
  // Convex Auth expone viewer; usamos la query isAuthenticated como helper
  const viewer = useQuery(api.auth.isAuthenticated, {});

  const isLoading = viewer === undefined;
  const isAuthenticated = viewer !== null && viewer !== undefined;

  return {
    isLoading,
    isAuthenticated,
    userId: viewer,
    signIn,
    signOut,
  };
}
