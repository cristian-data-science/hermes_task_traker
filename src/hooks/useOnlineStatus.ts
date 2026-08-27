import { useEffect, useState } from "react";

/** Estado de conexión del navegador (online/offline) reactivo. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  return online;
}

/** ¿Contexto móvil (puntero grueso)? Reactivo, para gates de UI. */
export function useIsMobileLike(): boolean {
  const [mobile, setMobile] = useState<boolean>(() => {
    try {
      return window.matchMedia("(pointer: coarse)").matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return mobile;
}
