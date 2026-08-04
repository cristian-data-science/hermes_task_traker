import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import type { ClickupConfig } from "~/convex/clickupConfig";
import { useAuth } from "../hooks/useAuth";
import { cn } from "../lib/utils";

interface ClickUpDestinationPickerProps {
  /** parentId actual de la tarea (undefined = Mesa Técnica). */
  value: string | undefined;
  onChange: (parentId: string | undefined) => void;
}

/**
 * Selector de destino ClickUp para tareas del área Patagonia.
 *
 * Dos niveles:
 *  1. Segmented control: "Mesa Técnica" (tarea suelta) | "Proyecto"
 *  2. Si Proyecto: dropdown de proyecto → dropdown de rama.
 *
 * Quick-pick de destinos recientes arriba (persistencia en localStorage).
 *
 * Si la tarea ya tiene clickupId, muestra link "Ver en ClickUp" + estado de sync.
 */
export function ClickUpDestinationPicker({
  value,
  onChange,
}: ClickUpDestinationPickerProps) {
  const { token } = useAuth();
  const state = useQuery(
    api.settings.getClickupState,
    token ? { sessionToken: token } : "skip",
  );
  const config: ClickupConfig | undefined = state?.config;

  // Resolver proyecto/destino actuales a partir del value (parentId).
  const current = useMemo(() => {
    if (!config || !value) return null;
    for (const proj of config.projects) {
      const dest = proj.destinations.find((d) => d.parentId === value);
      if (dest) return { projectId: proj.id, destinationId: dest.id };
    }
    return null;
  }, [config, value]);

  const isProject = !!value;
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
      // localStorage puede fallar (modo privado); no es crítico.
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
            // Al cambiar a Proyecto, preseleccionar el primer destino del primer proyecto.
            const first = config.projects[0]?.destinations[0]?.parentId;
            if (first) {
              onChange(first);
              pushRecent(first);
            }
          }}
          className={cn(
            "rounded-el px-2 py-1.5 text-xs font-medium transition-colors",
            isProject ? "bg-accent text-acfg" : "text-mute hover:text-ink",
          )}
        >
          Proyecto
        </button>
      </div>

      {/* Selector de proyecto + rama (solo si Proyecto) */}
      {isProject && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <select
            value={current?.projectId ?? ""}
            onChange={(e) => {
              const proj = config.projects.find((p) => p.id === e.target.value);
              const firstDest = proj?.destinations[0]?.parentId;
              if (firstDest) {
                onChange(firstDest);
                pushRecent(firstDest);
              }
            }}
            className="input py-1.5 text-sm"
          >
            {config.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            value={current?.destinationId ?? ""}
            onChange={(e) => {
              const proj = config.projects.find(
                (p) => p.id === (current?.projectId ?? config.projects[0]?.id),
              );
              const dest = proj?.destinations.find((d) => d.id === e.target.value);
              if (dest) {
                onChange(dest.parentId);
                pushRecent(dest.parentId);
              }
            }}
            className="input py-1.5 text-sm"
          >
            {(
              config.projects.find(
                (p) => p.id === (current?.projectId ?? config.projects[0]?.id),
              )?.destinations ?? []
            ).map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
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

/** Resuelve un parentId a una etiqueta legible ("Proyecto · Rama"). */
function resolveLabel(config: ClickupConfig, parentId: string): string {
  for (const proj of config.projects) {
    const dest = proj.destinations.find((d) => d.parentId === parentId);
    if (dest) return `${proj.label} · ${dest.label}`;
  }
  return parentId;
}
