import { useEffect, useState } from "react";

/**
 * Auth simple basada en PIN.
 *
 * El PIN correcto se define en `VITE_HERMES_PIN` (variable de entorno).
 * Al acertar, se guarda un flag en localStorage para persistir la sesión.
 *
 * No usa Convex Auth ni JWT — es lo más simple y robusto.
 */

const STORAGE_KEY = "hermes-auth-ok";

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true);

  // Al montar, leer el flag de localStorage
  useEffect(() => {
    try {
      const ok = localStorage.getItem(STORAGE_KEY) === "1";
      setIsAuthenticated(ok);
    } catch {
      setIsAuthenticated(false);
    }
    setIsLoading(false);
  }, []);

  /** Verifica el PIN. Devuelve true si es correcto. */
  async function signIn(pin: string): Promise<boolean> {
    const correctPin = import.meta.env.VITE_HERMES_PIN ?? "1234";
    if (pin === correctPin) {
      try {
        localStorage.setItem(STORAGE_KEY, "1");
      } catch {
        /* ignore */
      }
      setIsAuthenticated(true);
      return true;
    }
    return false;
  }

  function signOut() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setIsAuthenticated(false);
  }

  return { isLoading, isAuthenticated, signIn, signOut };
}
