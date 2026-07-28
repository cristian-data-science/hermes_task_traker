import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, Check, Lock } from "lucide-react";
import toast from "react-hot-toast";

/**
 * Modal para cambiar la contraseña.
 * Pide la contraseña actual (para verificar) y la nueva (2 veces).
 */
export function ChangePasswordModal({
  open,
  onClose,
  onChangePassword,
}: {
  open: boolean;
  onClose: () => void;
  onChangePassword: (current: string, next: string) => Promise<void>;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setCurrent("");
    setNext("");
    setConfirm("");
  }

  async function handleSubmit(e?: React.FormEvent | React.MouseEvent) {
    e?.preventDefault();
    if (!current || !next || !confirm) return;
    if (next !== confirm) {
      toast.error("Las contraseñas nuevas no coinciden");
      return;
    }
    if (next.length < 6) {
      toast.error("La nueva contraseña debe tener al menos 6 caracteres");
      return;
    }
    setSaving(true);
    try {
      await onChangePassword(current, next);
      toast.success("Contraseña actualizada 🔒");
      reset();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Lock className="h-4 w-4" />
                Cambiar contraseña
              </h2>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-muted hover:bg-hover"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
              <div>
                <label className="label">Contraseña actual</label>
                <input
                  type="password"
                  required
                  autoFocus
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  placeholder="••••••••"
                  className="input"
                  autoComplete="current-password"
                />
              </div>
              <div>
                <label className="label">Nueva contraseña</label>
                <input
                  type="password"
                  required
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  placeholder="mín. 6 caracteres"
                  className="input"
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="label">Repetir nueva contraseña</label>
                <input
                  type="password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  className="input"
                  autoComplete="new-password"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={onClose} className="btn-secondary">
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={saving || !current || !next || !confirm}
                  className="btn-primary"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Guardar
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
