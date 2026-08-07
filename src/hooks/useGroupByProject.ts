import { useCallback, useState } from "react";

/**
 * Persiste si el Kanban agrupa las tarjetas por proyecto (localStorage).
 * Mismo patrón que useHiddenColumns / useTheme.
 */
const STORAGE_KEY = "kanban-group-by-project";

function load(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function useGroupByProject() {
  const [enabled, setEnabled] = useState<boolean>(load);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // no crítico: se pierde la preferencia, no los datos
      }
      return next;
    });
  }, []);

  return { enabled, toggle };
}
