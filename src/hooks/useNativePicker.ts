/**
 * Picker nativo de Windows desde la web: carpetas o archivos.
 *
 * La web no puede abrir diálogos del sistema por seguridad; el protocolo
 * hermesagent://pick lanza el diálogo en el PC (agent-bridge/picker.mjs) y
 * el resultado se publica en Convex (`correos:pickReportar`, credenciales
 * del puente). Esta suscripción reactiva a `pickResultado` lo recibe solo:
 * no hace falta polling manual.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { useAuth } from "./useAuth";

export type PickerKind = "folder" | "files";

export function useNativePicker(
  onResult: (kind: PickerKind, paths: string[]) => void,
  onCancel?: () => void,
) {
  const { token } = useAuth();
  const [key, setKey] = useState<string | null>(null);
  const kindRef = useRef<PickerKind>("folder");
  const onResultRef = useRef(onResult);
  const onCancelRef = useRef(onCancel);
  onResultRef.current = onResult;
  onCancelRef.current = onCancel;

  const res = useQuery(
    api.correos.pickResultado,
    token && key ? { sessionToken: token, key } : "skip",
  );

  const abrir = useCallback((k: PickerKind) => {
    const id = `pk${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    kindRef.current = k;
    setKey(id);
    window.location.href = `hermesagent://pick?kind=${k}&key=${id}`;
  }, []);

  useEffect(() => {
    if (!key || !res) return;
    if (res.estado === "esperando") return;
    setKey(null);
    if (res.estado === "ok") onResultRef.current(kindRef.current, res.paths ?? []);
    else onCancelRef.current?.();
  }, [res, key]);

  return { abrir, esperando: !!key };
}
