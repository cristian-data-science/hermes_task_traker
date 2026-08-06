import { useState, useCallback } from "react";
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
  /** listId actual del destino. */
  listId?: string;
  /** Callback al cambiar el destino. */
  onChange: (parentId: string | undefined, listId?: string) => void;
}

/** Un folder del space. */
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
 * Diseño: SIN useEffects que modifiquen estado. Toda la inicialización se hace
 * una sola vez (al montar). El TaskModal remonta este componente cuando cambia
 * de tarea (vía ctxKey), así que la inicialización limpia está garantizada.
 *
 * Los re-renders por queries reactivas de Convex NO resetean el estado porque
 * no hay useEffects que escriban estado en respuesta a cambios de props/queries.
 */
export function ClickUpDestinationPicker({
  value,
  listId,
  onChange,
}: ClickUpDestinationPickerProps) {
  const { token } = useAuth();
  const config: ClickupConfig | undefined = useQuery(
    api.settings.getClickupState,
    token ? { sessionToken: token } : "skip",
  )?.config;
  const discover = useAction(api.clickup.discoverProjects);
  const resolveList = useAction(api.clickup.resolveTaskList);

  // ===== Estado que SOLO se inicializa al montar =====
  const isProjectMode = !!value;
  const [mode] = useState<"mesa" | "proyecto">(isProjectMode ? "proyecto" : "mesa");

  // Folders (cargados una vez).
  const [folders, setFolders] = useState<AvailableFolder[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(isProjectMode);
  const [foldersLoaded, setFoldersLoaded] = useState(false);

  // Folder seleccionado. Se inicializa lazy: cuando los folders cargan, se
  // resuelve por listId o por resolveTaskList.
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // ListId efectivo (resuelto si hace falta).
  const [resolvedListId, setResolvedListId] = useState<string | undefined>(listId);

  // ===== Cargar folders (una sola vez, al montar si es modo proyecto) =====
  const loadFolders = useCallback(async () => {
    if (!token || foldersLoaded) return;
    setLoadingFolders(true);
    try {
      const result = await discover({ sessionToken: token });
      setFolders(result.discovered);
      setFoldersLoaded(true);

      // Resolver el folder inicial.
      let lid = listId;
      // Si no hay listId pero hay value (parentId), resolver desde ClickUp.
      if (!lid && value) {
        try {
          const resolved = await resolveList({
            sessionToken: token,
            clickupId: value,
          });
          if (resolved.listId) {
            lid = resolved.listId;
            setResolvedListId(lid);
          }
        } catch {
          // ignorar
        }
      }
      // Buscar el folder que contiene lid.
      if (lid) {
        const match = result.discovered.find(
          (f: AvailableFolder) =>
            f.lists.some((l) => l.id === lid) || f.listId === lid,
        );
        if (match) {
          setSelectedFolderId(match.folderId);
          return;
        }
      }
      // Fallback: si hay value, buscar en config.projects.
      if (value && config) {
        for (const proj of config.projects) {
          if (proj.destinations.some((d) => d.parentId === value)) {
            const folder = result.discovered.find(
              (f: AvailableFolder) => f.listId === proj.listId,
            );
            if (folder) {
              setSelectedFolderId(folder.folderId);
              return;
            }
          }
        }
      }
    } catch {
      // silencioso
    } finally {
      setLoadingFolders(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, foldersLoaded, isProjectMode]);

  // Disparar la carga una sola vez.
  // Usamos un flag en ref para evitar re-disparos.
  const [started, setStarted] = useState(false);
  if (isProjectMode && !foldersLoaded && !loadingFolders && !started) {
    setStarted(true);
    void loadFolders();
  }

  const selectedFolder: AvailableFolder | undefined =
    folders.find((f) => f.folderId === selectedFolderId) ?? folders[0];

  const isProject = mode === "proyecto";
  const effectiveListId = listId ?? resolvedListId;

  function pushRecent(parentId: string) {
    try {
      const recent: string[] = JSON.parse(
        localStorage.getItem("hermes-clickup-recent-destinations") ?? "[]",
      );
      const next = [parentId, ...recent.filter((r) => r !== parentId)].slice(0, 5);
      localStorage.setItem("hermes-clickup-recent-destinations", JSON.stringify(next));
    } catch {
      // no crítico
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
          onClick={() => onChange(undefined)}
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
            // NO pisar value. Solo asegurar que el picker muestre el modo proyecto.
            // El folder ya debería estar resuelto si hay value.
          }}
          className={cn(
            "rounded-el px-2 py-1.5 text-xs font-medium transition-colors",
            isProject ? "bg-accent text-acfg" : "text-mute hover:text-ink",
          )}
        >
          Proyecto
        </button>
      </div>

      {/* Selector de proyecto + navegador (solo si Proyecto) */}
      {isProject && (
        <div className="space-y-2">
          {loadingFolders ? (
            <div className="flex items-center gap-1.5 px-2 py-2 text-xs text-mute">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Cargando proyectos de ClickUp…
            </div>
          ) : folders.length === 0 ? (
            <p className="px-2 py-2 text-xs text-mute">
              No se pudieron cargar los proyectos.
            </p>
          ) : (
            <>
              {/* Dropdown de proyecto */}
              <select
                value={selectedFolderId ?? ""}
                onChange={(e) => {
                  const f = folders.find((x) => x.folderId === e.target.value);
                  if (f) {
                    setSelectedFolderId(f.folderId);
                    onChange(undefined, f.listId);
                  }
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

              {/* Navegador de árbol */}
              {selectedFolder && (
                <FolderTreeSection
                  key={selectedFolder.folderId}
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

      {/* Recientes */}
      {!isProject &&
        (() => {
          try {
            const recent: string[] = JSON.parse(
              localStorage.getItem("hermes-clickup-recent-destinations") ?? "[]",
            );
            if (recent.length === 0) return null;
            return (
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="text-[10px] text-faint">Recientes:</span>
                {recent.slice(0, 3).map((parentId) => {
                  let label = parentId;
                  for (const proj of config.projects) {
                    const dest = proj.destinations.find(
                      (d) => d.parentId === parentId,
                    );
                    if (dest) {
                      label = `${proj.label} · ${dest.label}`;
                      break;
                    }
                  }
                  return (
                    <button
                      key={parentId}
                      type="button"
                      onClick={() => onChange(parentId)}
                      className="chip px-1.5 py-0.5 text-[10px]"
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            );
          } catch {
            return null;
          }
        })()}
    </div>
  );
}

/**
 * Sección de navegación del folder. Si tiene varias lists, dropdown para elegir;
 * luego el navegador de árbol. SIN useEffects: el key={folder.folderId} del
 * padre fuerza el remount cuando cambia el folder, reiniciando el estado limpio.
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
  const lists =
    folder.lists.length > 0
      ? folder.lists
      : [{ id: folder.listId, name: folder.listName || "Principal" }];
  const hasMultipleLists = lists.length > 1;

  // Init una sola vez (al montar). El key del padre garantiza remount limpio.
  const initialList =
    (listId && lists.some((l) => l.id === listId) ? listId : undefined) ??
    folder.listId;
  const [selectedListId, setSelectedListId] = useState<string>(initialList);

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
