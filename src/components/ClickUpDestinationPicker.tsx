import { useEffect, useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "~/convex/_generated/api";
import type { ClickupConfig } from "~/convex/clickupConfig";
import { ClickUpTreeNavigator } from "./ClickUpTreeNavigator";
import { useAuth } from "../hooks/useAuth";
import { cn } from "../lib/utils";

interface ClickUpDestinationPickerProps {
  /** parentId actual de la tarea (undefined = Mesa Técnica). */
  value: string | undefined;
  /** listId actual del destino (para reconstruir el selector al editar). */
  listId?: string;
  /** Callback al cambiar el destino. parentId vacío = Mesa Técnica. */
  onChange: (parentId: string | undefined, listId?: string) => void;
}

/** Un folder del space (integrado o no). */
interface AvailableFolder {
  folderId: string;
  folderName: string;
  listId: string;
  listName: string;
  lists: { id: string; name: string }[];
  alreadyIntegrated: boolean;
}

/**
 * Selector de destino ClickUp para tareas del área Patagonia.
 *
 * Dos modos:
 *  1. Mesa Técnica (tarea suelta) → parentId vacío.
 *  2. Proyecto → lista TODOS los folders del space (integrados o no) para que
 *     el usuario pueda crear tareas en cualquier proyecto, incluso si no tiene
 *     tareas asignadas ahí. Al elegir un folder, el navegador de árbol carga
 *     las raíces de su list y permite navegar a cualquier profundidad.
 */
export function ClickUpDestinationPicker({
  value,
  listId,
  onChange,
}: ClickUpDestinationPickerProps) {
  const { token } = useAuth();
  const state = useQuery(
    api.settings.getClickupState,
    token ? { sessionToken: token } : "skip",
  );
  const config: ClickupConfig | undefined = state?.config;
  const discover = useAction(api.clickup.discoverProjects);
  const resolveList = useAction(api.clickup.resolveTaskList);

  // Folders disponibles del space (cargados al entrar en modo proyecto).
  const [folders, setFolders] = useState<AvailableFolder[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  // listId resuelto desde ClickUp (para tareas viejas sin clickupListId).
  const [resolvedListId, setResolvedListId] = useState<string | undefined>(
    undefined,
  );

  // Si no hay listId pero hay value (parentId), resolver el listId desde ClickUp.
  useEffect(() => {
    if (!token || listId || !value || resolvedListId) return;
    let cancelled = false;
    resolveList({ sessionToken: token, clickupId: value })
      .then((result) => {
        if (!cancelled && result.listId) {
          setResolvedListId(result.listId);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, value, listId]);

  // El listId efectivo: el de la prop, o el resuelto desde ClickUp.
  const effectiveListId = listId ?? resolvedListId;

  // Modo: 'mesa' (tarea suelta) o 'proyecto'.
  const [mode, setMode] = useState<"mesa" | "proyecto">(
    value ? "proyecto" : "mesa",
  );
  useEffect(() => {
    setMode(value ? "proyecto" : "mesa");
    // Reset: al cambiar de tarea, permitir auto-selección del folder.
    setUserSelectedFolder(false);
    setSelectedFolderId(null);
    setResolvedListId(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Folder seleccionado en el dropdown (por folderId).
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  // Flag: ¿el usuario eligió un folder manualmente? Si yes, no auto-seleccionar.
  const [userSelectedFolder, setUserSelectedFolder] = useState(false);

  // Cuando los folders cargan o cambia el listId, auto-seleccionar el folder
  // que contiene la list de la tarea. Esto hace que al EDITAR una tarea con
  // destino ClickUp, el dropdown muestre el proyecto correcto desde el inicio.
  useEffect(() => {
    if (!foldersLoaded || folders.length === 0) return;
    if (userSelectedFolder) return; // el usuario eligió manualmente → respetar
    const lid = effectiveListId;
    if (!lid) {
      // Sin listId: intentar resolver por value (parentId) en config.projects.
      if (value && config) {
        for (const proj of config.projects) {
          if (proj.destinations.some((d) => d.parentId === value)) {
            const folder = folders.find((f) => f.listId === proj.listId);
            if (folder) setSelectedFolderId(folder.folderId);
            return;
          }
        }
      }
      return;
    }
    // Buscar el folder cuya list coincide con el listId de la tarea.
    const match = folders.find(
      (f) => f.lists.some((l) => l.id === lid) || f.listId === lid,
    );
    if (match) {
      setSelectedFolderId(match.folderId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foldersLoaded, folders, effectiveListId, value]);

  // Cargar folders del space al entrar en modo proyecto.
  async function loadFolders() {
    if (!token || foldersLoaded) return;
    setLoadingFolders(true);
    try {
      const result = await discover({ sessionToken: token });
      setFolders(result.discovered);
      setFoldersLoaded(true);
    } catch {
      // Silencioso: si falla, el dropdown queda vacío.
    } finally {
      setLoadingFolders(false);
    }
  }

  useEffect(() => {
    if (mode === "proyecto" && !foldersLoaded) {
      void loadFolders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, foldersLoaded]);

  const selectedFolder: AvailableFolder | undefined = useMemo(() => {
    if (folders.length === 0) return undefined;
    return (
      folders.find((f) => f.folderId === selectedFolderId) ?? folders[0]
    );
  }, [folders, selectedFolderId]);

  const isProject = mode === "proyecto";

  const recentKey = "hermes-clickup-recent-destinations";
  const recent: string[] = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(recentKey) ?? "[]");
    } catch {
      return [];
    }
  }, []);

  function pushRecent(parentId: string) {
    try {
      const next = [parentId, ...recent.filter((r) => r !== parentId)].slice(0, 5);
      localStorage.setItem(recentKey, JSON.stringify(next));
    } catch {
      // localStorage puede fallar; no es crítico.
    }
  }

  if (!config) return null;

  return (
    <div className="rounded-el border-el border-line bg-panel2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <label className="label mb-0">Destino ClickUp</label>
      </div>

      {/* Segmented control: Mesa Técnica | Proyecto */}
      <div className="mb-2.5 grid grid-cols-2 gap-1 rounded-el border-el border-line bg-panel p-0.5">
        <button
          type="button"
          onClick={() => {
            setMode("mesa");
            onChange(undefined);
          }}
          className={cn(
            "rounded-el px-2 py-1.5 text-xs font-medium transition-colors",
            !isProject ? "bg-accent text-acfg" : "text-mute hover:text-ink",
          )}
        >
          Mesa Técnica
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("proyecto");
            // NO pisar value ni listId aquí. El auto-select del folder se
            // encarga de mostrar el correcto sin disparar onChange.
          }}
          className={cn(
            "rounded-el px-2 py-1.5 text-xs font-medium transition-colors",
            isProject ? "bg-accent text-acfg" : "text-mute hover:text-ink",
          )}
        >
          Proyecto
        </button>
      </div>

      {/* Selector de proyecto + navegador de árbol (solo si Proyecto) */}
      {isProject && (
        <div className="space-y-2">
          {loadingFolders ? (
            <div className="flex items-center gap-1.5 px-2 py-2 text-xs text-mute">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Cargando proyectos de ClickUp…
            </div>
          ) : (
            <>
              {/* Dropdown de proyecto (TODOS los folders del space) */}
              <select
                value={selectedFolderId ?? ""}
                onChange={(e) => {
                  const f = folders.find((x) => x.folderId === e.target.value);
                  setSelectedFolderId(f?.folderId ?? null);
                  setUserSelectedFolder(true);
                  onChange(undefined, f?.listId);
                }}
                className="input py-1.5 text-sm"
              >
                {folders.map((f) => (
                  <option key={f.folderId} value={f.folderId}>
                    {f.folderName}
                    {f.alreadyIntegrated ? " ✓" : ""}
                  </option>
                ))}
              </select>

              {/* Selector de list (si hay varias) + navegador de árbol */}
              {selectedFolder && (
                <FolderTreeSection
                  folder={selectedFolder}
                  value={value}
                  listId={effectiveListId}
                  onChange={(parentId, lid) => {
                    onChange(parentId, lid);
                    if (parentId) pushRecent(parentId);
                  }}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* Quick-pick de recientes */}
      {recent.length > 0 && !isProject && (
        <div className="mt-2 flex flex-wrap gap-1">
          <span className="text-[10px] text-faint">Recientes:</span>
          {recent.slice(0, 3).map((parentId) => {
            const label = resolveLabel(config, parentId);
            return (
              <button
                key={parentId}
                type="button"
                onClick={() => {
                  onChange(parentId);
                  pushRecent(parentId);
                }}
                className="chip px-1.5 py-0.5 text-[10px]"
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Sección de navegación del folder. Si tiene varias lists, primero un dropdown
 * para elegir la list; luego siempre el navegador de árbol.
 */
function FolderTreeSection({
  folder,
  value,
  listId,
  onChange,
}: {
  folder: AvailableFolder;
  value: string | undefined;
  listId?: string;
  onChange: (parentId: string | undefined, listId?: string) => void;
}) {
  const lists = folder.lists.length > 0
    ? folder.lists
    : [{ id: folder.listId, name: folder.listName || "Principal" }];
  const hasMultipleLists = lists.length > 1;

  // La list a usar: la del listId de la tarea si está en este folder, si no,
  // la principal del folder.
  const initialList =
    (listId && lists.some((l) => l.id === listId) ? listId : undefined) ??
    folder.listId;
  const [selectedListId, setSelectedListId] = useState<string>(initialList);

  // Sincronizar si cambia el listId externo (al abrir otra tarea) o el folder.
  useEffect(() => {
    const target =
      (listId && lists.some((l) => l.id === listId) ? listId : undefined) ??
      folder.listId;
    if (target !== selectedListId) {
      setSelectedListId(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId, folder.folderId]);

  return (
    <div className="space-y-2">
      {hasMultipleLists && (
        <select
          value={selectedListId}
          onChange={(e) => {
            const newLid = e.target.value;
            setSelectedListId(newLid);
            onChange(undefined, newLid);
          }}
          className="input py-1.5 text-sm"
        >
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      )}

      <ClickUpTreeNavigator
        listId={selectedListId}
        selectedParentId={value}
        onSelect={(parentId) => {
          onChange(parentId ? parentId : undefined, selectedListId);
        }}
      />
    </div>
  );
}

/** Resuelve un parentId a una etiqueta legible ("Proyecto · Rama"). */
function resolveLabel(config: ClickupConfig, parentId: string): string {
  for (const proj of config.projects) {
    const dest = proj.destinations.find((d) => d.parentId === parentId);
    if (dest) return `${proj.label} · ${dest.label}`;
  }
  return parentId;
}
