/**
 * Sección "Contrato del agente" de la vista Agente: las reglas que guían a
 * los agentes, visibles y EDITABLES desde la app.
 *
 * - Contrato operativo (reglas de oro + recetas por tipo): textareas que se
 *   guardan en Convex; el puente las lee al armar CADA prompt, así que una
 *   edición aplica desde el próximo despacho sin reiniciar nada.
 * - CONTRATO_AGENTE.md completo: solo lectura (viaja empaquetado con el build
 *   del repo — Vite ?raw), es el documento formal versionado en Git.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ChevronDown, ScrollText, Loader2, RotateCcw, Save, FileText } from "lucide-react";
import toast from "react-hot-toast";
import contratoMd from "../../CONTRATO_AGENTE.md?raw";
import { api } from "~/convex/_generated/api";
import { useAuth } from "../hooks/useAuth";
import { cn } from "../lib/utils";

const RECIPE_FIELDS = [
  ["reporte", "Receta: Reporte (Power BI)"],
  ["desarrollo", "Receta: Desarrollo (repo Git)"],
  ["analisis", "Receta: Análisis"],
  ["ops", "Receta: Ops"],
  ["otro", "Receta: Otro"],
] as const;

export function AgentContractSection() {
  const { token } = useAuth();
  const contract = useQuery(
    api.agent.getContract,
    token ? { sessionToken: token } : "skip",
  );
  const saveContract = useMutation(api.agent.saveContract);

  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem("agent-contract-open") === "1";
    } catch {
      return false;
    }
  });
  const [showFull, setShowFull] = useState(false);
  const [golden, setGolden] = useState("");
  const [recipes, setRecipes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Hidratar el editor cuando llega el contrato (o cambia su savedAt tras guardar).
  const savedAt = contract?.savedAt;
  useEffect(() => {
    if (!contract) return;
    setGolden(contract.goldenRules.join("\n"));
    setRecipes({ ...contract.typeRecipes });
  }, [contract, savedAt]);

  function toggleOpen() {
    setOpen((v) => {
      try {
        localStorage.setItem("agent-contract-open", v ? "0" : "1");
      } catch {
        // sin localStorage: igual colapsa
      }
      return !v;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveContract({
        sessionToken: token!,
        goldenRules: golden.split("\n").map((r) => r.trim()).filter(Boolean),
        typeRecipes: {
          reporte: recipes.reporte ?? "",
          desarrollo: recipes.desarrollo ?? "",
          analisis: recipes.analisis ?? "",
          ops: recipes.ops ?? "",
          otro: recipes.otro ?? "",
        },
      });
      toast.success("Contrato guardado — aplica desde el próximo despacho");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    if (!contract?.defaults || !confirm("¿Restablecer todas las reglas a los valores por defecto?"))
      return;
    setGolden(contract.defaults.goldenRules.join("\n"));
    setRecipes({ ...contract.defaults.typeRecipes });
  }

  return (
    <div className="overflow-hidden rounded-el border-el border-line">
      {/* Cabecera colapsable (igual que las carpetas) */}
      <button
        onClick={toggleOpen}
        aria-expanded={open}
        className="flex w-full items-center gap-2 bg-panel2/40 px-3 py-2.5 text-left transition-colors hover:bg-panel2"
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-faint transition-transform",
            open && "rotate-180",
          )}
        />
        <ScrollText className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
        <span className="text-xs font-semibold text-ink">Contrato del agente</span>
        <span className="hidden text-[10px] text-faint sm:inline">
          · reglas de oro y recetas por tipo — editables, aplican al próximo despacho
        </span>
        <span className="ml-auto text-[10px] text-faint">
          {contract?.isDefault
            ? "valores por defecto"
            : contract?.savedAt
              ? `editado ${formatWhen(contract.savedAt)}`
              : ""}
        </span>
      </button>

      {open && (
        <div className="space-y-3 p-3">
          {/* Reglas de oro */}
          <div>
            <label className="label">Reglas de oro (una por línea)</label>
            <textarea
              value={golden}
              onChange={(e) => setGolden(e.target.value)}
              rows={5}
              className="input resize-y font-mono text-xs"
            />
          </div>

          {/* Recetas por tipo */}
          {RECIPE_FIELDS.map(([key, label]) => (
            <div key={key}>
              <label className="label">{label}</label>
              <textarea
                value={recipes[key] ?? ""}
                onChange={(e) => setRecipes((r) => ({ ...r, [key]: e.target.value }))}
                rows={3}
                className="input resize-y font-mono text-xs"
              />
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void handleSave()}
              disabled={saving || !contract}
              className="btn-primary inline-flex items-center gap-1.5 text-xs"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Guardar contrato
            </button>
            <button
              onClick={handleReset}
              disabled={saving || !contract}
              className="btn-ghost inline-flex items-center gap-1.5 border-el text-xs text-mute hover:text-ink"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restablecer
            </button>
          </div>

          {/* Contrato formal completo: solo lectura */}
          <div className="border-t border-line pt-2.5">
            <button
              onClick={() => setShowFull((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-mute transition-colors hover:text-ink"
            >
              <FileText className="h-3.5 w-3.5" />
              {showFull ? "Ocultar" : "Ver"} CONTRATO_AGENTE.md completo (solo lectura)
            </button>
            {showFull && (
              <pre className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-el border-el border-line bg-panel p-3 font-mono text-[11px] leading-relaxed text-mute">
                {contratoMd}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatWhen(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 2) return "ahora";
  if (m < 90) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 36) return `hace ${h} h`;
  return new Date(ts).toLocaleDateString("es-CL");
}
