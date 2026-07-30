import { useCallback, useState } from "react";
import type { Status } from "../lib/constants";

/**
 * Persiste qué columnas del Kanban están ocultas (localStorage).
 * Las columnas ocultas no se renderizan, pero siguen siendo destinos
 * válidos internamente para el drag-and-drop.
 *
 * Patrón basado en useTheme.ts.
 */
const STORAGE_KEY = "kanban-hidden-cols";

function load(): Status[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s) => typeof s === "string") as Status[];
  } catch {
    return [];
  }
}

export function useHiddenColumns() {
  const [hidden, setHidden] = useState<Status[]>(load);

  function persist(next: Status[]) {
    setHidden(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  const toggle = useCallback(
    (status: Status) => {
      setHidden((prev) => {
        const next = prev.includes(status)
          ? prev.filter((s) => s !== status)
          : [...prev, status];
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [],
  );

  const showAll = useCallback(() => persist([]), []);

  const isHidden = useCallback(
    (status: Status) => hidden.includes(status),
    [hidden],
  );

  return { hidden, toggle, showAll, isHidden };
}
