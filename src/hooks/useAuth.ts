import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";

/**
 * Auth personal: 1 sola contraseña, sin registro.
 *
 * - Token de sesión guardado en localStorage.
 * - verifySession (query reactiva) confirma el token en cada carga.
 * - signIn (action) compara la contraseña en el backend y devuelve un token.
 */

const TOKEN_KEY = "hermes-session-token";

export function useAuth() {
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });

  const valid = useQuery(api.authQuery.verifySession, token ? { token } : "skip");
  const signInAction = useAction(api.auth.signIn);
  const signOutAction = useAction(api.auth.signOut);

  function setSessionToken(t: string | null) {
    setToken(t);
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }

  async function signIn(password: string) {
    const result = (await signInAction({ password })) as { token: string };
    setSessionToken(result.token);
    return result;
  }

  async function signOut() {
    if (token) {
      try {
        await signOutAction({ token });
      } catch {
        /* ignore */
      }
    }
    setSessionToken(null);
  }

  // valid === undefined → cargando (solo si hay token)
  // valid === true     → sesión activa
  // valid === false    → sin sesión / token inválido
  const isLoading = token !== null && valid === undefined;
  const isAuthenticated = valid === true;

  return { isLoading, isAuthenticated, signIn, signOut };
}
