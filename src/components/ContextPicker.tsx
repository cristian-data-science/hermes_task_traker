/**
 * Selector de contexto con el picker nativo de Windows: carpetas para
 * explorar y archivos puntuales para leer. Lo usa "Responder con el agente"
 * (TaskModal) y la respuesta a preguntas del agente (AgentRunsPanel).
 */
import { FolderOpen, FileText, X, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { useNativePicker } from "../hooks/useNativePicker";

export interface ContextPaths {
  carpetas: string[];
  archivos: string[];
}

export const EMPTY_CONTEXT: ContextPaths = { carpetas: [], archivos: [] };

export function ContextPicker({
  value,
  onChange,
}: {
  value: ContextPaths;
  onChange: (next: ContextPaths) => void;
}) {
  const { abrir, esperando } = useNativePicker(
    (kind, paths) => {
      if (!paths.length) return;
      if (kind === "folder") {
        onChange({
          ...value,
          carpetas: [...new Set([...value.carpetas, ...paths])],
        });
      } else {
        onChange({
          ...value,
          archivos: [...new Set([...value.archivos, ...paths])],
        });
      }
      toast.success(
        kind === "folder"
          ? `Carpeta agregada (${paths[0]})`
          : `${paths.length} archivo(s) agregado(s)`,
      );
    },
    () => toast("Selección cancelada"),
  );

  const quitar = (kind: "carpetas" | "archivos", p: string) =>
    onChange({ ...value, [kind]: value[kind].filter((x) => x !== p) });

  const hay = value.carpetas.length > 0 || value.archivos.length > 0;

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={esperando}
          onClick={() => abrir("folder")}
          className="btn-ghost inline-flex items-center gap-1.5 border-el text-xs hover:text-ink"
          title="Diálogo de carpetas de Windows: la carpeta es de CONSULTA (el agente la lee, no la toca)"
        >
          {esperando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FolderOpen className="h-3.5 w-3.5" />
          )}
          Elegir carpeta…
        </button>
        <button
          type="button"
          disabled={esperando}
          onClick={() => abrir("files")}
          className="btn-ghost inline-flex items-center gap-1.5 border-el text-xs hover:text-ink"
          title="Diálogo de archivos de Windows (multiselección): archivos que el agente lee como contexto"
        >
          {esperando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileText className="h-3.5 w-3.5" />
          )}
          Elegir archivos…
        </button>
      </div>
      {hay && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {value.carpetas.map((p) => (
            <span
              key={p}
              className="inline-flex max-w-full items-center gap-1 rounded-el border-el border-line bg-panel2 px-1.5 py-0.5 font-mono text-[10px] text-mute"
              title={p}
            >
              <FolderOpen className="h-3 w-3 shrink-0" />
              <span className="truncate">{p}</span>
              <button
                type="button"
                onClick={() => quitar("carpetas", p)}
                className="shrink-0 rounded p-0.5 text-faint hover:text-danger"
                title="Quitar"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {value.archivos.map((p) => (
            <span
              key={p}
              className="inline-flex max-w-full items-center gap-1 rounded-el border-el border-line bg-panel2 px-1.5 py-0.5 font-mono text-[10px] text-mute"
              title={p}
            >
              <FileText className="h-3 w-3 shrink-0" />
              <span className="truncate">{p}</span>
              <button
                type="button"
                onClick={() => quitar("archivos", p)}
                className="shrink-0 rounded p-0.5 text-faint hover:text-danger"
                title="Quitar"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {esperando && (
        <p className="mt-1 text-[10px] text-faint">
          Eligiendo… (diálogo de Windows; si no aparece, mira si el navegador
          pidió permiso para abrir el protocolo)
        </p>
      )}
    </div>
  );
}
