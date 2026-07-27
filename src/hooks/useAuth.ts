import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";

/**
 * Auth segura con email + contraseña.
 *
 * - Token de sesión guardado en localStorage.
 * - En cada carga, se verifica el token contra el backend vía query reactiva.
 * - signIn/signUp (actions con hashing PBKDF2) guardan el token y disparan
 *   la re-verificación, que re-renderiza App automáticamente.
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

  // verifySession es query reactiva: cambia cuando el token cambia
  const user = useQuery(api.authQuery.verifySession, token ? { token } : "skip");

  const signInAction = useAction(api.auth.signIn);
  const signUpAction = useAction(api.auth.signUp);
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

  async function signIn(email: string, password: string) {
    const result = (await signInAction({ email, password })) as {
      token: string;
      email: string;
    };
    setSessionToken(result.token);
    return result;
  }

  async function signUp(email: string, password: string) {
    const result = (await signUpAction({ email, password })) as {
      token: string;
      email: string;
    };
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

  // user === undefined → cargando (solo si hay token y aún no respondió)
  // user === null      → sin sesión / token inválido
  // user === {...}     → sesión activa
  const isLoading = token !== null && user === undefined;
  const isAuthenticated = user !== null && user !== undefined;

  return { isLoading, isAuthenticated, user, signIn, signUp, signOut };
}
