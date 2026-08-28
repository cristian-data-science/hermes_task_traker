import { useCallback, useState } from "react";

const KEY = "kanban-state-snap";

/**
 * Preferencia del tablero: al scrollear horizontal en el teléfono, ¿encuadre
 * por estado (snap obligatorio: cada swipe deja UN estado completo) o scroll
 * libre? Persistida en localStorage. Default: ON (encuadrado).
 */
export function useSnapToStatus() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEY) !== "0";
    } catch {
      return true;
    }
  });

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(KEY, next ? "1" : "0");
      } catch {
        /* preferencia cosmética: no rompe nada si falla */
      }
      return next;
    });
  }, []);

  return { enabled, toggle };
}
