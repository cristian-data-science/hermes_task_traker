import {
  createContext,
  useContext,
  useState,
  useMemo,
  type ReactNode,
} from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { signChallenge } from "../lib/rsa";

/**
 * Auth personal por challenge-response RSA (sin contraseña).
 *
 * Refactorizado a Provider + Context para que el `token` de sesión esté
 * disponible en toda la app y se pueda inyectar en cada llamada al backend
 * (que ahora lo exige para autorizar la operación).
 *
 * - Token de sesión guardado en localStorage (persiste en el navegador,
 *   NO en incógnito ni en otros navegadores).
 * - verifySession (query reactiva) confirma el token en cada carga.
 * - signIn(file): pide un challenge al backend, lo firma con la clave privada
 *   del .p8 arrastrado, y envía la firma. La clave privada nunca sale del
 *   navegador.
 */

const TOKEN_KEY = "hermes-session-token";

export interface AuthContextValue {
  /** Token de sesión actual (null si no hay). Se pasa al backend en cada llamada. */
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Inicia sesión firmando un challenge con el archivo .p8 (clave privada). */
  signIn: (file: File) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });

  const valid = useQuery(api.authQuery.verifySession, token ? { token } : "skip");
  const createChallengeAction = useAction(api.auth.createChallenge);
  const signInWithRsaAction = useAction(api.auth.signInWithRsa);
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

  async function signIn(file: File) {
    // 1) Pedir un challenge (nonce de un solo uso) al backend.
    const { challenge } = await createChallengeAction({});
    // 2) Firmar el challenge con la clave privada del archivo (en el navegador).
    const signature = await signChallenge(file, challenge);
    // 3) Enviar la firma; el backend la verifica con la clave pública.
    const result = (await signInWithRsaAction({
      challenge,
      signature,
    })) as { token: string };
    setSessionToken(result.token);
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

  const isLoading = token !== null && valid === undefined;
  // Si había token pero la sesión dejó de ser válida (caducó...), limpiar el
  // token para forzar login.
  const isAuthenticated = valid === true;
  if (token !== null && valid === false) {
    setSessionToken(null);
  }

  const value = useMemo<AuthContextValue>(
    () => ({ token, isLoading, isAuthenticated, signIn, signOut }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, valid],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Hook para consumir el contexto de auth. Lanza si se usa fuera del provider. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  }
  return ctx;
}
