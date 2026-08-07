import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useAction } from "convex/react";
import {
  X,
  Loader2,
  Check,
  Power,
  RefreshCw,
  AlertTriangle,
  UserCog,
  FolderTree,
  Copy,
} from "lucide-react";
import toast from "react-hot-toast";
import { api } from "~/convex/_generated/api";
import { useAuth } from "../hooks/useAuth";
import { AREAS, AREA_META } from "../lib/constants";
import { cn } from "../lib/utils";

interface ClickUpSettingsProps {
  open: boolean;
  onClose: () => void;
  /** Navegar a la página de sincronización ClickUp. */
  onGoToSync: () => void;
}

/**
 * Panel de configuración de la integración ClickUp.
 *
 * - Toggle global de sync outbound (enabled on/off).
 * - Checkbox "Recibir actualizaciones a la inversa" (inbound) por cada proyecto
 *   y por Mesa Técnica. Controla el alcance del botón de sync reversa.
 * - Timestamps del último sync outbound y último scan inbound.
 */
export function ClickUpSettings({ open, onClose, onGoToSync }: ClickUpSettingsProps) {
  const { token } = useAuth();
  const state = useQuery(
    api.settings.getClickupState,
    token ? { sessionToken: token } : "skip",
  );
  const setEnabled = useMutation(api.settings.setEnabled);
  const setForceSyncDev = useMutation(api.settings.setForceSyncDev);
  const toggleHiddenArea = useMutation(api.settings.toggleHiddenArea);
  const syncAssignees = useAction(api.clickup.syncAssignees);
  const [syncingAssignees, setSyncingAssignees] = useState(false);
  const backfillPaths = useAction(api.clickup.backfillClickupPaths);
  const [backfilling, setBackfilling] = useState(false);
  const cleanupDupes = useAction(api.clickup.cleanupDuplicateTasks);
  const [cleaning, setCleaning] = useState(false);

  /**
   * Busca la misma tarea de ClickUp importada más de una vez y deja una sola.
   * Primero cuenta (dryRun) y pide confirmación: no toca nada sin avisar.
   */
  async function handleCleanupDuplicates() {
    setCleaning(true);
    try {
      const preview = (await cleanupDupes({
        sessionToken: token!,
        dryRun: true,
      })) as { groups: number; removed: number };
      if (preview.groups === 0) {
        toast.success("No hay tareas duplicadas");
        return;
      }
      const okGo = confirm(
        `Se encontraron ${preview.groups} tarea(s) duplicada(s) en el tablero ` +
          `(${preview.removed} copia(s) de más).\n\n` +
          `Se conserva la más vieja de cada una y se retiran las copias del ` +
          `tablero. En ClickUp no se toca nada.\n\n¿Continuar?`,
      );
      if (!okGo) return;
      const r = (await cleanupDupes({ sessionToken: token! })) as {
        removed: number;
      };
      toast.success(`${r.removed} copia(s) retirada(s) del tablero`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error al limpiar duplicados",
      );
    } finally {
      setCleaning(false);
    }
  }

  /**
   * Resuelve y guarda la ubicación en ClickUp de cada tarea sincronizada. Es
   * lo que alimenta la agrupación por proyecto del tablero. Se corre una vez
   * para las tareas viejas, y de nuevo si renombraste fases o proyectos.
   */
  async function handleBackfillPaths(refreshAll: boolean) {
    setBackfilling(true);
    try {
      const r = (await backfillPaths({
        sessionToken: token!,
        refreshAll,
      })) as { updated: number; failed: number; total: number };
      if (r.total === 0) {
        toast.success("Todas las tareas ya tenían su ubicación resuelta");
      } else {
        toast.success(
          `${r.updated} de ${r.total} ubicaciones resueltas` +
            (r.failed > 0 ? ` · ${r.failed} sin resolver` : ""),
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error al resolver ubicaciones",
      );
    } finally {
      setBackfilling(false);
    }
  }

  async function handleSyncAssignees() {
    setSyncingAssignees(true);
    try {
      const result = await syncAssignees({ sessionToken: token! });
      const { fixed, failed } = result as {
        fixed: number;
        failed: { clickupId: string; error: string }[];
      };
      toast.success(
        `${fixed} responsable${fixed !== 1 ? "s" : ""} actualizado${fixed !== 1 ? "s" : ""}`,
      );
      // Los fallos por tarea ya no se descartan: antes solo se veía el
      // contador de éxitos y no había forma de saber que otras fallaron.
      if (failed?.length > 0) {
        toast.error(
          `${failed.length} tarea${failed.length !== 1 ? "s" : ""} no se pudo${failed.length !== 1 ? "ieron" : ""} leer de ClickUp`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al sincronizar");
    } finally {
      setSyncingAssignees(false);
    }
  }

  async function handleToggleArea(area: string, visible: boolean) {
    try {
      // visible=true → hidden=false; visible=false → hidden=true
      await toggleHiddenArea({ sessionToken: token!, area, hidden: !visible });
    } catch (err) {
      toast.error("No se pudo actualizar la visibilidad del área");
    }
  }

  async function handleToggleEnabled(next: boolean) {
    try {
      await setEnabled({ sessionToken: token!, enabled: next });
      toast.success(next ? "Sync ClickUp activado" : "Sync ClickUp en pausa");
    } catch (err) {
      toast.error("No se pudo cambiar el estado del sync");
    }
  }

  async function handleToggleForceSyncDev(next: boolean) {
    try {
      await setForceSyncDev({ sessionToken: token!, force: next });
      toast.success(
        next
          ? "Sync forzado en dev — las próximas tareas irán a ClickUp real"
          : "Sync desactivado en dev",
      );
    } catch (err) {
      toast.error("No se pudo cambiar el override de sync");
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 48, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 340, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[94dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border-el border-line bg-panel shadow-el-lg sm:max-h-[88vh] sm:rounded-el-lg"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-line px-4 py-3.5 sm:px-5 sm:py-4">
              <h2 className="font-display text-lg font-semibold text-ink">
                ClickUp · Patagonia
              </h2>
              <button
                onClick={onClose}
                className="rounded-el p-1.5 text-faint transition-colors hover:bg-panel2 hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {!state ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-mute" />
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Aviso de modo desarrollo + override de prueba */}
                  {state.isDev && (
                    <div className="rounded-el border-el border-amber-300/50 bg-amber-300/10 p-3 text-amber-700 dark:text-amber-300">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="flex-1 text-xs leading-relaxed">
                          <p className="font-semibold">
                            Modo desarrollo — ClickUp desactivado
                          </p>
                          <p className="mt-0.5 opacity-90">
                            Las tareas que crees o edites acá{" "}
                            <strong>no se envían a ClickUp</strong>, para no
                            ensuciar el workspace compartido.
                          </p>
                          {/* Por qué se detectó dev: si estás en producción y
                              ves esto, falta la variable de entorno. */}
                          <p className="mt-1 opacity-75">
                            Señal detectada:{" "}
                            <code className="rounded bg-amber-300/20 px-1">
                              {state.envSignal}
                            </code>
                            {state.envSignal === "sin marca de producción" && (
                              <>
                                {" "}
                                — si esto es producción, falta setear{" "}
                                <code className="rounded bg-amber-300/20 px-1">
                                  HERMES_ENV=production
                                </code>{" "}
                                en el deployment.
                              </>
                            )}
                          </p>
                        </div>
                      </div>
                      {/* Override de prueba: forzar sync en dev */}
                      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-amber-300/30 pt-2.5">
                        <div className="text-xs">
                          <p className="font-semibold">Forzar sync en dev</p>
                          <p className="opacity-80">
                            Activa el outbound contra ClickUp real para probar.
                            Apagalo al terminar.
                          </p>
                        </div>
                        <Toggle
                          checked={state.forceSyncDev}
                          onChange={handleToggleForceSyncDev}
                        />
                      </div>
                    </div>
                  )}

                  {/* Toggle global */}
                  <div className="flex items-center justify-between gap-3 rounded-el border-el border-line bg-panel2 p-3">
                    <div className="flex items-center gap-2.5">
                      <Power
                        className={cn(
                          "h-5 w-5",
                          state.enabled ? "text-accent" : "text-faint",
                        )}
                      />
                      <div>
                        <p className="text-sm font-semibold text-ink">
                          Sincronización ClickUp
                        </p>
                        <p className="text-xs text-mute">
                          {state.enabled ? "Activa (outbound)" : "En pausa"}
                        </p>
                      </div>
                    </div>
                    <Toggle
                      checked={state.enabled}
                      onChange={handleToggleEnabled}
                    />
                  </div>

                  {/* Sincronización inbound — botón que lleva a la página de sync */}
                  <div className="rounded-el border-el border-line bg-panel2 p-3">
                    <p className="text-sm font-semibold text-ink">
                      Sincronización desde ClickUp
                    </p>
                    <p className="mt-0.5 text-xs text-mute">
                      Elegí qué carpetas, proyectos o tareas querés importar y
                      mantener sincronizadas. Explorás el árbol de ClickUp y
                      marcás qué traer.
                    </p>
                    <button
                      onClick={() => {
                        onClose();
                        onGoToSync();
                      }}
                      className="btn-primary mt-2 px-2.5 py-1.5 text-xs"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Ir a sincronización
                    </button>
                    <button
                      onClick={handleSyncAssignees}
                      disabled={syncingAssignees}
                      className="btn-secondary mt-2 px-2.5 py-1.5 text-xs"
                    >
                      {syncingAssignees ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <UserCog className="h-3.5 w-3.5" />
                      )}
                      Re-sincronizar responsables
                    </button>
                    <button
                      onClick={() => handleBackfillPaths(false)}
                      disabled={backfilling}
                      title="Resuelve en qué proyecto y fase vive cada tarea, para poder agrupar el tablero"
                      className="btn-secondary mt-2 px-2.5 py-1.5 text-xs"
                    >
                      {backfilling ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FolderTree className="h-3.5 w-3.5" />
                      )}
                      Resolver proyectos
                    </button>
                    <button
                      onClick={handleCleanupDuplicates}
                      disabled={cleaning}
                      title="Busca la misma tarea de ClickUp importada dos veces y deja una sola. No toca ClickUp."
                      className="btn-secondary mt-2 px-2.5 py-1.5 text-xs"
                    >
                      {cleaning ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      Limpiar duplicadas
                    </button>
                    <button
                      onClick={() => handleBackfillPaths(true)}
                      disabled={backfilling}
                      title="Recalcula TODAS las ubicaciones. Útil si renombraste fases o proyectos en ClickUp."
                      className="btn-ghost mt-2 px-2.5 py-1.5 text-xs"
                    >
                      Recalcular todas
                    </button>
                  </div>

                  {/* Áreas visibles (solo visualización) */}
                  <div>
                    <p className="label">Áreas visibles</p>
                    <p className="mb-2 text-xs text-mute">
                      Ocultá áreas que no uses. Es solo visual: las tareas
                      siguen existiendo y sincronizándose.
                    </p>
                    <div className="space-y-2">
                      {AREAS.map((a) => {
                        const meta = AREA_META[a];
                        const hidden = (state.hiddenAreas ?? []).includes(a);
                        return (
                          <InboundRow
                            key={a}
                            label={meta.label}
                            description={hidden ? "Oculta" : "Visible"}
                            checked={!hidden}
                            onChange={(v) => handleToggleArea(a, v)}
                          />
                        );
                      })}
                    </div>
                  </div>

                  {/* Info de timestamps */}
                  <div className="space-y-1.5 rounded-el border-el border-line bg-panel2 p-3 text-xs text-mute">
                    <div className="flex items-center gap-1.5">
                      <RefreshCw className="h-3 w-3" />
                      <span>
                        Último sync outbound:{" "}
                        <span className="font-medium text-ink">
                          {state.lastSyncAt
                            ? new Date(state.lastSyncAt).toLocaleString("es")
                            : "nunca"}
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <RefreshCw className="h-3 w-3" />
                      <span>
                        Último escaneo inbound:{" "}
                        <span className="font-medium text-ink">
                          {state.lastInboundAt
                            ? new Date(state.lastInboundAt).toLocaleString("es")
                            : "nunca"}
                        </span>
                      </span>
                    </div>
                  </div>

                  <p className="text-[11px] leading-relaxed text-faint">
                    Solo las tareas del área <strong>Patagonia</strong> se
                    sincronizan con ClickUp. Las áreas Personal y Datacef nunca
                    tocan ClickUp.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
              <button onClick={onClose} className="btn-secondary">
                <Check className="h-4 w-4" />
                Listo
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Fila de checkbox inbound para un proyecto o Mesa Técnica. */
function InboundRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-el border-el border-line p-2.5 transition-colors hover:bg-panel2">
      <div>
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-[11px] text-mute">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </label>
  );
}

/** Toggle switch accesible. */
function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onChange(!checked);
      }}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
        checked ? "bg-accent" : "bg-line",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-el",
          checked ? "left-[1.375rem]" : "left-0.5",
        )}
      />
    </button>
  );
}
