import { useEffect, useState } from "react";

/**
 * Expone el prompt de instalación PWA cuando el navegador lo ofrece
 * (beforeinstallprompt) — y SOLO en móvil (pointer coarse), porque la
 * restricción del proyecto es que la web de escritorio no cambia NADA.
 *
 * El evento debe capturarse sí o sí: si nadie lo escucha, Chrome lo descarta
 * y el botón in-app no podría dispararlo después.
 */
export function usePwaInstall() {
  const [canInstall, setCanInstall] = useState(false);
  const [promptEvent, setPromptEvent] = useState<any>(null);

  useEffect(() => {
    // Guard móvil: en desktop este hook nunca activa nada.
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e);
      setCanInstall(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    // Si la app ya está instalada, no ofrecemos nada.
    window.addEventListener("appinstalled", () => setCanInstall(false));
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  async function install(): Promise<boolean> {
    if (!promptEvent) return false;
    promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    setCanInstall(false);
    return choice?.outcome === "accepted";
  }

  return { canInstall, install };
}

/** ¿Contexto móvil (puntero grueso)? Para gate de UI exclusiva de teléfono. */
export function isMobileLike(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}
