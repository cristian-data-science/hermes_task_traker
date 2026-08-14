import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { ChevronRight, Loader2, RefreshCw } from "lucide-react";
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
  /**
   * clickupId de la tarea EN SÍ (si ya está sincronizada). Es la fuente de
   * verdad para saber dónde vive: se le pregunta a ClickUp por la tarea misma
   * en vez de deducirlo del parentId o del clickupListId persistido, que
   * pueden estar desactualizados o apuntar a otra list.
   */
  taskClickupId?: string;
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

/** Ubicación resuelta de un destino guardado (folder → list → ancestros). */
interface ResolvedPath {
  listId: string | null;
  listName: string | null;
  folderId: string | null;
  folderName: string | null;
  /** De la raíz hacia abajo, incluyendo el nodo padre de la tarea. */
  path: { id: string; name: string }[];
}

/**
 * Caché de rutas por parentId. La jerarquía de un nodo cambia poco y resolverla
 * cuesta una llamada por nivel, así que reabrir la misma tarea es instantáneo.
 */
const pathCache = new Map<string, ResolvedPath>();

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
  taskClickupId,
  onChange,
}: ClickUpDestinationPickerProps) {
  const { token } = useAuth();
  const config: ClickupConfig | undefined = useQuery(
    api.settings.getClickupState,
    token ? { sessionToken: token } : "skip",
  )?.config;
  const discover = useAction(api.clickup.discoverProjects);
  const resolvePath = useAction(api.clickup.resolveTaskPath);

  // Props "congeladas" al montar: se usan solo para la resolución inicial, así
  // un cambio posterior de las props no re-dispara nada.
  const initialValueRef = useRef(value);
  const initialListIdRef = useRef(listId);
  const taskClickupIdRef = useRef(taskClickupId);

  // ===== Modo (Mesa Técnica | Proyecto) =====
  // Se DERIVA del destino guardado mientras el usuario no toque los botones;
  // en cuanto elige uno, su elección manda para siempre (modeOverride).
  //
  // Es una derivación pura, no un setState dentro de un efecto: por eso no
  // reintroduce el ciclo de resets. Elegir un folder emite
  // onChange(undefined, listId) y deja `value` en undefined, pero modeOverride
  // ya está fijado en "proyecto" y nada lo pisa.
  const [modeOverride, setModeOverride] = useState<"mesa" | "proyecto" | null>(
    null,
  );
  const savedListIsProject =
    !!listId && !!config && listId !== config.mesaTecnica.listId;
  const mode: "mesa" | "proyecto" =
    modeOverride ?? (value || savedListIsProject ? "proyecto" : "mesa");
  const setMode = setModeOverride;
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
  /** Ubicación jerárquica del destino guardado (para breadcrumb + expansión). */
  const [savedPath, setSavedPath] = useState<ResolvedPath | null>(null);
  const [resolvingPath, setResolvingPath] = useState(false);
  /** Motivo por el que no se pudo resolver la ubicación (se muestra en la UI). */
  const [pathError, setPathError] = useState<string | null>(null);

  /**
   * List efectiva del árbol. Mientras el usuario no navegue, gana la resuelta
   * contra ClickUp (el `listId` persistido puede estar sucio, ver arriba). En
   * cuanto elige folder/list a mano, manda la prop, que refleja su elección.
   */
  const userChangedList = listId !== initialListIdRef.current;
  const effectiveListId = userChangedList
    ? listId
    : (resolvedListId ?? listId);

  /**
   * Resuelve, una única vez, dónde vive el destino que ya tiene la tarea:
   * qué folder mostrar en el dropdown y la cadena de ancestros para abrir el
   * árbol en esa rama. Solo aplica al ABRIR una tarea existente con destino.
   */
  const resolveInitialFolder = useCallback(
    async (loaded: AvailableFolder[]) => {
      if (userPickedFolderRef.current) return;
      const initialValue = initialValueRef.current;
      const selfId = taskClickupIdRef.current;
      let lid = initialListIdRef.current;
      let info: ResolvedPath | null = null;

      // A quién le preguntamos "¿dónde vivís?":
      //   1. A la TAREA MISMA si ya está sincronizada (selfId). Es la fuente de
      //      verdad directa y funciona aunque el parentId guardado esté viejo
      //      o el clickupListId apunte a otra list.
      //   2. Si no está sincronizada todavía, al nodo padre guardado.
      const lookupId = selfId ?? initialValue;
      if (lookupId && token) {
        info = pathCache.get(lookupId) ?? null;
        if (!info) {
          setResolvingPath(true);
          setPathError(null);
          try {
            info = (await resolvePath({
              sessionToken: token,
              clickupId: lookupId,
            })) as ResolvedPath;
            pathCache.set(lookupId, info);
          } catch (err) {
            // Antes esto se tragaba en silencio y el picker quedaba mudo:
            // sin breadcrumb y con el folder equivocado, sin decir por qué.
            setPathError(
              err instanceof Error
                ? err.message
                : "No se pudo resolver la ubicación en ClickUp",
            );
          } finally {
            setResolvingPath(false);
          }
        }
        if (info) {
          // Si preguntamos por la tarea misma, el último nodo de la ruta ES la
          // tarea: lo sacamos, porque la ubicación que interesa es la de su
          // ancla (el resto de la cadena).
          let chain = info.path;
          if (
            selfId &&
            chain.length > 0 &&
            chain[chain.length - 1].id === selfId
          ) {
            chain = chain.slice(0, -1);
          }
          if (chain.length > 0 || info.listId) {
            setSavedPath({ ...info, path: chain });
          }
          if (info.path.length === 0 && !info.listId) {
            setPathError(
              "ClickUp no devolvió la ubicación (¿la tarea o su padre fueron borrados allá?)",
            );
          }
          // La verdad la tiene ClickUp, NO el clickupListId persistido.
          // Ese campo lo pisa _markSynced con la list donde se INTENTÓ crear
          // la tarea, que para un parent no mapeado en config era la de Mesa
          // Técnica; ClickUp después la movía a la list del parent. Por eso
          // había tareas de Ley de Datos que reabrían en "Mesa Técnica
          // Interna". Si ClickUp nos dice la list real, esa manda.
          if (info.listId) {
            lid = info.listId;
            setResolvedListId(lid);
          }
        }
      }

      if (userPickedFolderRef.current) return; // el usuario eligió mientras tanto

      // 1) Por list: el folder que contiene la list del destino.
      if (lid) {
        const match = loaded.find(
          (f) => f.lists.some((l) => l.id === lid) || f.listId === lid,
        );
        if (match) {
          setSelectedFolderId(match.folderId);
          return;
        }
      }

      // 2) Por folder directo: ClickUp nos dijo en qué folder vive el nodo.
      if (info?.folderId) {
        const byFolder = loaded.find((f) => f.folderId === info!.folderId);
        if (byFolder) {
          setSelectedFolderId(byFolder.folderId);
          return;
        }
      }

      // 3) Fallback: buscar el parentId en los destinos configurados.
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

  // Ruta a auto-expandir en el árbol: solo mientras el destino siga siendo el
  // guardado. Si el usuario ancla en otro nodo, deja de aplicar.
  const expandPath =
    savedPath && value && value === initialValueRef.current
      ? savedPath.path.map((n) => n.id)
      : undefined;

  /**
   * Breadcrumb legible del destino guardado: Folder › List › raíz › … › nodo.
   * Colapsa repetidos consecutivos: es habitual que la tarea-raíz se llame
   * igual que su list (ej. "Ley de Datos › Ley de Datos").
   */
  const breadcrumb = (() => {
    let parts: (string | null | undefined)[];
    // Solo mientras el destino siga siendo el guardado: si el usuario ancla en
    // otro nodo, mostrar la ubicación vieja sería mentirle.
    if (savedPath && value === initialValueRef.current) {
      parts = [
        savedPath.folderName,
        savedPath.listName,
        ...savedPath.path.map((n) => n.name),
        // Sin ancestros = la tarea está suelta en la list.
        savedPath.path.length === 0 ? "(nivel 0, sin anidar)" : null,
      ];
    } else if (isProject && effectiveListId && !value) {
      // Destino plano (sin padre): la ubicación es folder › list, que ya
      // tenemos en los folders cargados. No hace falta llamar a ClickUp.
      const f = folders.find(
        (x) =>
          x.lists.some((l) => l.id === effectiveListId) ||
          x.listId === effectiveListId,
      );
      if (!f) return [];
      const l = f.lists.find((x) => x.id === effectiveListId);
      parts = [f.folderName, l?.name ?? f.listName, "(nivel 0, sin anidar)"];
    } else {
      return [];
    }
    return parts
      .filter((s): s is string => !!s)
      .filter((s, i, arr) => i === 0 || s.trim() !== arr[i - 1].trim());
  })();

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

      {/* Ubicación guardada: dónde vive HOY la tarea en ClickUp, con la
          jerarquía completa. Es lo primero que se ve al reabrir la tarea. */}
      {(breadcrumb.length > 0 || resolvingPath || pathError) && (
        <div className="mb-2.5 rounded-el border-el border-line bg-panel px-2 py-1.5">
          <p className="mb-0.5 text-[10px] uppercase tracking-wide text-faint">
            Ubicación en ClickUp
          </p>
          {resolvingPath && breadcrumb.length === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-mute">
              <Loader2 className="h-3 w-3 animate-spin" />
              Resolviendo ubicación…
            </span>
          ) : breadcrumb.length === 0 && pathError ? (
            <span className="text-[11px] leading-snug text-danger">
              {pathError}
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-x-0.5 gap-y-0.5">
              {breadcrumb.map((label, i) => (
                <span key={`${label}-${i}`} className="flex items-center">
                  {i > 0 && (
                    <ChevronRight className="h-3 w-3 shrink-0 text-faint" />
                  )}
                  <span
                    className={cn(
                      "text-[11px] leading-tight",
                      // El último nivel es donde cuelga la tarea: mismo acento
                      // que el nodo resaltado en el árbol, para que la vista
                      // salte de un lado al otro sin buscar.
                      i === breadcrumb.length - 1
                        ? "rounded bg-accent/15 px-1 py-0.5 font-bold text-accent"
                        : "text-mute",
                    )}
                  >
                    {label}
                  </span>
                </span>
              ))}
            </div>
          )}
          {savedPath && value === initialValueRef.current && (
            <p className="mt-0.5 text-[10px] leading-snug text-faint">
              La tarea cuelga del último nivel.
            </p>
          )}
        </div>
      )}

      {/* Segmented control: Mesa Técnica | Proyecto */}
      <div className="mb-2.5 grid grid-cols-2 gap-1 rounded-el border-el border-line bg-panel p-0.5">
        <button
          type="button"
          onClick={() => {
            setMode("mesa");
            // Se emite la list de Mesa EXPLÍCITAMENTE: el sync outbound es
            // opt-in (solo publica tareas con destino explícito), así que
            // "mandarla a Mesa Técnica" tiene que distinguirse de "sin
            // destino / solo local" (que es onChange(undefined, undefined)).
            onChange(undefined, config.mesaTecnica.listId);
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
                  expandPath={expandPath}
                  taskClickupId={taskClickupId}
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
  expandPath,
  taskClickupId,
  onChange,
}: {
  folder: AvailableFolder;
  value: string | undefined;
  listId?: string;
  /** Ruta de ancestros a abrir al montar (destino guardado). */
  expandPath?: string[];
  /** clickupId de la tarea editada, para marcarla en el árbol. */
  taskClickupId?: string;
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
        // Solo auto-expandimos si el árbol es el de la list del destino
        // guardado; si el usuario cambió de list, la ruta ya no aplica.
        expandPath={selectedListId === listId ? expandPath : undefined}
        taskClickupId={taskClickupId}
        onSelect={(parentId) => {
          onChange(parentId ? parentId : undefined, selectedListId);
        }}
      />
    </div>
  );
}
