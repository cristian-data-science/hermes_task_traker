import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "~/convex/_generated/api";
import type { ClickupConfig } from "~/convex/clickupConfig";
import { ClickUpTreeNavigator } from "./ClickUpTreeNavigator";
import { useAuth } from "../hooks/useAuth";
import { cn } from "../lib/utils";

interface ClickUpDestinationPickerProps {
  /** parentId actual de la tarea (undefined = sin anidar). */
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

// ============================================================
//  Caché de folders a nivel módulo
// ============================================================
// discoverProjects pega a la API de ClickUp y tarda ~1-2s. Sin caché, cada
// apertura del modal re-descarga la estructura completa del space, que es la
// causa del "se taldea" al navegar. Cacheamos por 5 minutos; el botón
// ↻ fuerza el refresco.

const FOLDERS_TTL_MS = 5 * 60 * 1000;
let foldersCache: { at: number; data: AvailableFolder[] } | null = null;

function readFoldersCache(): AvailableFolder[] | null {
  if (!foldersCache) return null;
  if (Date.now() - foldersCache.at > FOLDERS_TTL_MS) {
    foldersCache = null;
    return null;
  }
  return foldersCache.data;
}

/**
 * Selector de destino ClickUp para tareas del área Patagonia.
 *
 * ===== INVARIANTE DE DISEÑO (no romper) =====
 * El estado de NAVEGACIÓN (modo, folder elegido, list elegida) pertenece al
 * usuario: SOLO cambia por una interacción explícita suya. Nunca se deriva de
 * las props ni de queries reactivas de Convex.
 *
 * El bug histórico venía de un `useEffect(() => setMode(value ? ... : "mesa"),
 * [value])`: al elegir un folder se emitía `onChange(undefined, listId)`, el
 * `value` seguía undefined, el efecto disparaba y colapsaba todo a Mesa Técnica
 * / Administrativo. La "solución" posterior congeló el modo con
 * `const [mode] = useState(...)` y dejó el botón "Proyecto" sin handler, o sea
 * muerto: por eso no abría nada.
 *
 * Regla: el ÚNICO useEffect permitido acá es el que CARGA DATOS (folders), está
 * guardado por un ref, y no toca la selección salvo la resolución inicial de
 * una tarea que ya tiene destino.
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

  // Props "congeladas" al montar: se usan solo para la resolución inicial, así
  // un cambio posterior de las props no re-dispara nada.
  const initialValueRef = useRef(value);
  const initialListIdRef = useRef(listId);

  // ===== Estado de navegación (propiedad del usuario) =====
  const [mode, setMode] = useState<"mesa" | "proyecto">(
    value ? "proyecto" : "mesa",
  );
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  /** true cuando el usuario tocó el dropdown: bloquea la resolución automática. */
  const userPickedFolderRef = useRef(false);

  // ===== Estado de datos =====
  const [folders, setFolders] = useState<AvailableFolder[]>(
    () => readFoldersCache() ?? [],
  );
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolvedListId, setResolvedListId] = useState<string | undefined>(
    listId,
  );
  /** Guard de carga: evita dobles fetch (StrictMode, re-renders). */
  const loadStartedRef = useRef(false);

  const effectiveListId = listId ?? resolvedListId;

  /**
   * Resuelve, una única vez, qué folder corresponde al destino que ya tiene la
   * tarea. Solo aplica al ABRIR una tarea existente con destino.
   */
  const resolveInitialFolder = useCallback(
    async (loaded: AvailableFolder[]) => {
      if (userPickedFolderRef.current) return;
      const initialValue = initialValueRef.current;
      let lid = initialListIdRef.current;

      // Tarea vieja sin clickupListId: preguntarle a ClickUp en qué list vive.
      if (!lid && initialValue && token) {
        try {
          const resolved = await resolveList({
            sessionToken: token,
            clickupId: initialValue,
          });
          if (resolved.listId) {
            lid = resolved.listId;
            setResolvedListId(lid);
          }
        } catch {
          // no crítico: seguimos con el fallback por config
        }
      }

      if (userPickedFolderRef.current) return; // el usuario eligió mientras tanto

      if (lid) {
        const match = loaded.find(
          (f) => f.lists.some((l) => l.id === lid) || f.listId === lid,
        );
        if (match) {
          setSelectedFolderId(match.folderId);
          return;
        }
      }

      // Fallback: buscar el parentId en los destinos configurados.
      if (initialValue && config) {
        for (const proj of config.projects) {
          if (proj.destinations.some((d) => d.parentId === initialValue)) {
            const folder = loaded.find((f) => f.listId === proj.listId);
            if (folder) {
              setSelectedFolderId(folder.folderId);
              return;
            }
          }
        }
      }
    },
    // `config` se lee al ejecutar; no queremos re-crear el callback por él.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token],
  );

  /** Carga los folders del space. `force` ignora la caché. */
  const loadFolders = useCallback(
    async (force = false) => {
      if (!token) return;
      if (!force) {
        const cached = readFoldersCache();
        if (cached) {
          setFolders(cached);
          void resolveInitialFolder(cached);
          return;
        }
      }
      setLoadingFolders(true);
      setLoadError(null);
      try {
        const result = await discover({ sessionToken: token });
        const data = result.discovered as AvailableFolder[];
        foldersCache = { at: Date.now(), data };
        setFolders(data);
        void resolveInitialFolder(data);
      } catch (err) {
        setLoadError(
          err instanceof Error
            ? err.message
            : "No se pudieron cargar los proyectos",
        );
      } finally {
        setLoadingFolders(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, resolveInitialFolder],
  );

  // ÚNICO efecto del componente: carga de datos. No toca modo ni selección.
  // Se dispara al entrar en modo proyecto y corre una sola vez (ref guard).
  useEffect(() => {
    if (mode !== "proyecto") return;
    if (loadStartedRef.current) return;
    if (!token) return;
    loadStartedRef.current = true;
    void loadFolders();
  }, [mode, token, loadFolders]);

  const isProject = mode === "proyecto";
  const selectedFolder = selectedFolderId
    ? folders.find((f) => f.folderId === selectedFolderId)
    : undefined;

  function pushRecent(parentId: string) {
    try {
      const recent: string[] = JSON.parse(
        localStorage.getItem("hermes-clickup-recent-destinations") ?? "[]",
      );
      const next = [parentId, ...recent.filter((r) => r !== parentId)].slice(
        0,
        5,
      );
      localStorage.setItem(
        "hermes-clickup-recent-destinations",
        JSON.stringify(next),
      );
    } catch {
      // no crítico
    }
  }

  if (!config) return null;

  return (
    <div className="rounded-el border-el border-line bg-panel2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <label className="label mb-0">Destino ClickUp</label>
        {isProject && folders.length > 0 && (
          <button
            type="button"
            onClick={() => void loadFolders(true)}
            disabled={loadingFolders}
            title="Refrescar la lista de proyectos desde ClickUp"
            className="inline-flex items-center gap-1 text-[10px] text-faint hover:text-ink disabled:opacity-50"
          >
            <RefreshCw
              className={cn("h-3 w-3", loadingFolders && "animate-spin")}
            />
            Refrescar
          </button>
        )}
      </div>

      {/* Segmented control: Mesa Técnica | Proyecto */}
      <div className="mb-2.5 grid grid-cols-2 gap-1 rounded-el border-el border-line bg-panel p-0.5">
        <button
          type="button"
          onClick={() => {
            setMode("mesa");
            onChange(undefined, undefined);
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
          onClick={() => setMode("proyecto")}
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
          {loadingFolders && folders.length === 0 ? (
            <div className="flex items-center gap-1.5 px-2 py-2 text-xs text-mute">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Cargando proyectos de ClickUp…
            </div>
          ) : loadError ? (
            <div className="px-2 py-2 text-xs text-danger">
              {loadError}{" "}
              <button
                type="button"
                onClick={() => void loadFolders(true)}
                className="underline hover:no-underline"
              >
                Reintentar
              </button>
            </div>
          ) : folders.length === 0 ? (
            <p className="px-2 py-2 text-xs text-mute">
              No hay proyectos disponibles en el space.
            </p>
          ) : (
            <>
              {/* Dropdown de proyecto. Sin auto-selección: mientras el usuario
                  no elija, queda el placeholder (nada se mueve solo). */}
              <select
                value={selectedFolderId ?? ""}
                onChange={(e) => {
                  const f = folders.find((x) => x.folderId === e.target.value);
                  userPickedFolderRef.current = true;
                  if (!f) {
                    setSelectedFolderId(null);
                    onChange(undefined, undefined);
                    return;
                  }
                  setSelectedFolderId(f.folderId);
                  // Cambiar de proyecto invalida el parent anterior.
                  onChange(undefined, f.listId);
                }}
                className="input py-1.5 text-sm"
              >
                <option value="">— Elegí un proyecto —</option>
                {folders.map((f) => (
                  <option key={f.folderId} value={f.folderId}>
                    {f.folderName}
                    {f.alreadyIntegrated ? " ✓" : ""}
                  </option>
                ))}
              </select>

              {/* Tarea ya anclada a un destino que no cae en ningún folder
                  listado (list fuera de folder, proyecto archivado, etc.).
                  Se avisa en vez de mostrar el selector vacío como si nada. */}
              {!selectedFolder && value && (
                <p className="px-2 py-1.5 text-[11px] leading-snug text-mute">
                  Esta tarea ya está anclada a un destino que no coincide con
                  ninguno de los proyectos listados. Si no tocás nada, el destino
                  se mantiene; elegí un proyecto solo si querés moverla.
                </p>
              )}

              {/* Navegador de árbol. key = folderId → remount limpio al
                  cambiar de proyecto, sin useEffects de sincronización. */}
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

      {/* Recientes (solo en modo Mesa Técnica) */}
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
                      onClick={() => {
                        setMode("proyecto");
                        onChange(parentId);
                      }}
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
            // Cambiar de list invalida el parent anterior.
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
