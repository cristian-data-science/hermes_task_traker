import { useEffect, useState } from "react";
import {
  Terminal,
  Newspaper,
  Zap,
  Binary,
  type LucideIcon,
} from "lucide-react";

/** Los 4 temas de Cris Agent Task. Matrix primero (default). */
export const THEMES = ["matrix", "terminal", "paper", "brutal"] as const;
export type ThemeId = (typeof THEMES)[number];

export const THEME_META: Record<ThemeId, { label: string; Icon: LucideIcon }> =
  {
    matrix: { label: "Matrix", Icon: Binary },
    terminal: { label: "Ámbar", Icon: Terminal },
    paper: { label: "Papel", Icon: Newspaper },
    brutal: { label: "Brutal", Icon: Zap },
  };

const STORAGE_KEY = "cat-theme";

function isTheme(v: string | null): v is ThemeId {
  return !!v && (THEMES as readonly string[]).includes(v);
}

/** Hook de tema: 4 temas intercambiables, persistidos en localStorage. */
export function useTheme() {
  const [theme, setTheme] = useState<ThemeId>(() => {
    if (typeof window === "undefined") return "matrix";
    const saved = localStorage.getItem(STORAGE_KEY);
    return isTheme(saved) ? saved : "matrix";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
    // Limpieza del sistema anterior (claro/oscuro)
    localStorage.removeItem("hermes-theme");
    document.documentElement.classList.remove("dark");
  }, [theme]);

  return { theme, setTheme };
}
