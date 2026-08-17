import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import {
  Search,
  Loader2,
  Check,
  Plus,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import toast from "react-hot-toast";
import { api } from "~/convex/_generated/api";
import type {
  ClickupConfig,
  ClickupProject,
} from "~/convex/clickupConfig";
import { useAuth } from "../hooks/useAuth";

interface ProjectDiscoveryProps {
  /** Config actual (para saber qué está integrado y editar destinos). */
  config: ClickupConfig;
}

/** Un destino editable en el editor inline. */
interface EditableDestination {
  label: string;
  parentId: string; // "" = sin parent (tareas generales)
}

/**
 * Sección "Proyectos disponibles": descubre folders de ClickUp donde Cris tiene
 * tareas asignadas, permite integrarlos con destinos auto-detectados (editables)
 * y corregir destinos de proyectos ya integrados.
 */
export function ProjectDiscovery({ config }: ProjectDiscoveryProps) {
  const { token } = useAuth();
  const discover = useAction(api.clickup.discoverProjects);
  const addProject = useMutation(api.settings.addProject);
  const updateProject = useMutation(api.settings.updateProject);
  const removeProject = useMutation(api.settings.removeProject);

  const [loading, setLoading] = useState(false);
  const [discovered, setDiscovered] = useState<
    {
      folderId: string;
      folderName: string;
      listId: string;
      listName: string;
      lists: { id: string; name: string }[];
      taskCount: number;
      suggestedDestinations: { label: string; parentId: string | null }[];
      alreadyIntegrated: boolean;
    }[]
  >([]);
  const [scanned, setScanned] = useState(false);
  /** folderId del proyecto cuyo editor está expandido. */
  const [editingId, setEditingId] = useState<string | null>(null);

  async function handleDiscover() {
    if (!token) return;
    setLoading(true);
    try {
      const result = await discover({ sessionToken: token });
      // Re-cruzar alreadyIntegrated con la config más fresca que tenemos.
      const integratedListIds = new Set(config.projects.map((p) => p.listId));
      setDiscovered(
        result.discovered.map((d) => ({
          ...d,
          alreadyIntegrated: integratedListIds.has(d.listId),
        })),
      );
      setScanned(true);
      if (result.discovered.length === 0) {
        toast.success("No hay proyectos nuevos. Todas tus tareas ya están integradas.");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error al descubrir proyectos",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleIntegrate(
    folderId: string,
    folderName: string,
    listId: string,
    lists: { id: string; name: string }[],
    dests: EditableDestination[],
  ) {
    if (!token || !listId) {
      toast.error("El proyecto no tiene una list válida");
      return;
    }
    const projectId = slugify(folderName) + "-" + folderId.slice(-4);
    const project: ClickupProject = {
      id: projectId,
      label: folderName,
      listId,
      // Persistir todas las lists del folder para el selector multi-list.
      ...(lists.length > 1 ? { lists } : {}),
      inbound: true,
      destinations: dests.map((d) => ({
        id: slugify(d.label) || "destino",
        label: d.label,
        parentId: d.parentId || undefined,
      })),
    };
    try {
      await addProject({ sessionToken: token!, project: JSON.stringify(project) });
      toast.success(`"${folderName}" integrado`);
      // Marcar como integrado en el estado local.
      setDiscovered((items) =>
        items.map((d) =>
          d.folderId === folderId ? { ...d, alreadyIntegrated: true } : d,
        ),
      );
      setEditingId(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo integrar el proyecto",
      );
    }
  }

  async function handleSaveEdit(projectId: string, project: ClickupProject) {
    try {
      await updateProject({
        sessionToken: token!,
        projectId,
        project: JSON.stringify(project),
      });
      toast.success("Destinos actualizados");
      setEditingId(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudieron guardar los cambios",
      );
    }
  }

  async function handleRemove(projectId: string, label: string) {
    if (!confirm(`¿Quitar "${label}" del tracking? Las tareas ya importadas no se borran.`))
      return;
    try {
      await removeProject({ sessionToken: token!, projectId });
      toast.success(`"${label}" quitado del tracking`);
      setEditingId(null);
    } catch (err) {
      toast.error("No se pudo quitar el proyecto");
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="label mb-0">Proyectos disponibles</p>
          <p className="text-xs text-mute">
            Carpetas de ClickUp donde tienes tareas asignadas.
          </p>
        </div>
        <button
          onClick={handleDiscover}
          disabled={loading}
          className="btn-secondary shrink-0 px-2.5 py-1.5 text-xs"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          Descubrir
        </button>
      </div>

      {/* Resultados del descubrimiento */}
      {scanned && discovered.length === 0 && !loading && (
        <p className="rounded-el border-el border-line bg-panel2 p-3 text-xs text-mute">
          No se encontraron proyectos donde tengas tareas asignadas (o ya están
          todos integrados).
        </p>
      )}

      <div className="space-y-1.5">
        {discovered.map((d) => (
          <DiscoveredRow
            key={d.folderId}
            folderName={d.folderName}
            listName={d.listName}
            taskCount={d.taskCount}
            alreadyIntegrated={d.alreadyIntegrated}
            editing={editingId === d.folderId}
            onToggleEdit={() =>
              setEditingId((id) => (id === d.folderId ? null : d.folderId))
            }
            // Destinos iniciales del editor: sugeridos si no integrado, o los
            // actuales del config si ya integrado.
            initialDestinations={
              d.alreadyIntegrated
                ? (config.projects
                    .find((p) => p.listId === d.listId)
                    ?.destinations.map((dst) => ({
                      label: dst.label,
                      parentId: dst.parentId ?? "",
                    })) ?? toEditable(d.suggestedDestinations))
                : toEditable(d.suggestedDestinations)
            }
            existingProject={
              d.alreadyIntegrated
                ? config.projects.find((p) => p.listId === d.listId)
                : undefined
            }
            onIntegrate={(dests) =>
              handleIntegrate(
                d.folderId,
                d.folderName,
                d.listId,
                d.lists,
                dests,
              )
            }
            onSaveEdit={(project) => handleSaveEdit(project.id, project)}
            onRemove={() =>
              handleRemove(
                config.projects.find((p) => p.listId === d.listId)?.id ?? "",
                d.folderName,
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

/** Convierte destinos sugeridos al formato editable. */
function toEditable(
  dests: { label: string; parentId: string | null }[],
): EditableDestination[] {
  return dests.map((d) => ({ label: d.label, parentId: d.parentId ?? "" }));
}

/** Convierte un texto en slug ASCII para usar como id. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// ===== Fila de un proyecto descubierto + editor inline =====

interface DiscoveredRowProps {
  folderName: string;
  listName: string;
  taskCount: number;
  alreadyIntegrated: boolean;
  editing: boolean;
  initialDestinations: EditableDestination[];
  existingProject?: ClickupProject;
  onToggleEdit: () => void;
  onIntegrate: (dests: EditableDestination[]) => void;
  onSaveEdit: (project: ClickupProject) => void;
  onRemove: () => void;
}

function DiscoveredRow({
  folderName,
  listName,
  taskCount,
  alreadyIntegrated,
  editing,
  initialDestinations,
  existingProject,
  onToggleEdit,
  onIntegrate,
  onSaveEdit,
  onRemove,
}: DiscoveredRowProps) {
  return (
    <div className="rounded-el border-el border-line bg-panel2">
      {/* Header de la fila */}
      <div className="flex items-center justify-between gap-2 p-2.5">
        <button
          onClick={onToggleEdit}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {editing ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-mute" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-mute" />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">
              {folderName}
              {alreadyIntegrated && (
                <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-accent">
                  <Check className="h-3 w-3" /> Integrado
                </span>
              )}
            </p>
            <p className="truncate text-[11px] text-mute">
              {listName} · {taskCount} tarea{taskCount !== 1 ? "s" : ""}
            </p>
          </div>
        </button>
        {!editing && !alreadyIntegrated && (
          <button
            onClick={onToggleEdit}
            className="btn-secondary shrink-0 px-2 py-1 text-[11px]"
          >
            Integrar
          </button>
        )}
        {!editing && alreadyIntegrated && (
          <button
            onClick={onToggleEdit}
            className="btn-ghost shrink-0 p-1 text-mute hover:text-accent"
            title="Editar destinos"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Editor inline de destinos */}
      {editing && (
        <DestinationEditor
          folderName={folderName}
          initial={initialDestinations}
          alreadyIntegrated={alreadyIntegrated}
          existingProject={existingProject}
          onCancel={onToggleEdit}
          onConfirm={(dests) => {
            if (alreadyIntegrated && existingProject) {
              onSaveEdit({
                ...existingProject,
                destinations: dests.map((d) => ({
                  id: slugify(d.label) || "destino",
                  label: d.label,
                  parentId: d.parentId || undefined,
                })),
              });
            } else {
              onIntegrate(dests);
            }
          }}
          onRemove={alreadyIntegrated ? onRemove : undefined}
        />
      )}
    </div>
  );
}

// ===== Editor de destinos (lista editable) =====

interface DestinationEditorProps {
  folderName: string;
  initial: EditableDestination[];
  alreadyIntegrated: boolean;
  existingProject?: ClickupProject;
  onCancel: () => void;
  onConfirm: (dests: EditableDestination[]) => void;
  onRemove?: () => void;
}

function DestinationEditor({
  folderName,
  initial,
  alreadyIntegrated,
  onCancel,
  onConfirm,
  onRemove,
}: DestinationEditorProps) {
  const [dests, setDests] = useState<EditableDestination[]>(
    initial.length > 0 ? initial : [{ label: "Tareas generales", parentId: "" }],
  );

  function update(idx: number, field: keyof EditableDestination, value: string) {
    setDests((d) =>
      d.map((item, i) => (i === idx ? { ...item, [field]: value } : item)),
    );
  }
  function add() {
    setDests((d) => [...d, { label: "", parentId: "" }]);
  }
  function remove(idx: number) {
    setDests((d) => d.filter((_, i) => i !== idx));
  }

  return (
    <div className="border-t border-line p-2.5">
      <p className="mb-2 text-[11px] text-mute">
        {alreadyIntegrated ? "Editar destinos de" : "Destinos sugeridos para"}{" "}
        <strong className="text-ink">{folderName}</strong>. Cada destino es una
        rama bajo la que anidar las tareas (vacío = tareas planas).
      </p>
      <div className="space-y-1.5">
        {dests.map((d, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={d.label}
              onChange={(e) => update(i, "label", e.target.value)}
              placeholder="Nombre del destino"
              className="input min-w-0 flex-1 py-1 text-xs"
            />
            <input
              value={d.parentId}
              onChange={(e) => update(i, "parentId", e.target.value)}
              placeholder="Parent ID (opcional)"
              className="input w-32 shrink-0 py-1 font-mono text-[10px]"
            />
            <button
              onClick={() => remove(i)}
              className="btn-ghost shrink-0 p-1 text-mute hover:text-danger"
              title="Quitar destino"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={add}
        className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
      >
        <Plus className="h-3 w-3" /> Añadir destino
      </button>

      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line pt-2">
        <div>
          {onRemove && (
            <button
              onClick={onRemove}
              className="btn-ghost text-[11px] text-danger hover:bg-panel2"
            >
              <Trash2 className="h-3 w-3" />
              Quitar del tracking
            </button>
          )}
        </div>
        <div className="flex gap-1.5">
          <button onClick={onCancel} className="btn-secondary px-2.5 py-1 text-[11px]">
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(dests.filter((d) => d.label.trim()))}
            disabled={dests.every((d) => !d.label.trim())}
            className="btn-primary px-2.5 py-1 text-[11px]"
          >
            <Check className="h-3 w-3" />
            {alreadyIntegrated ? "Guardar" : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
