import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Lock, ArrowRight, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";
import { BrandMark } from "./Toolbar";

/**
 * Pantalla de login: solo contraseña (app personal).
 */
export function LoginScreen({
  signIn,
}: {
  signIn: (password: string) => Promise<unknown>;
}) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e?: React.FormEvent | React.MouseEvent) {
    e?.preventDefault();
    if (!password) return;
    setSubmitting(true);
    try {
      await signIn(password);
      toast.success("Bienvenido, Cristian");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      {/* Glow de acento del tema activo */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -left-24 -top-24 h-80 w-80 rounded-full blur-3xl"
          style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)" }}
        />
        <div
          className="absolute -bottom-32 -right-24 h-96 w-96 rounded-full blur-3xl"
          style={{ background: "color-mix(in srgb, var(--accent) 9%, transparent)" }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="relative w-full max-w-sm"
      >
        <div className="mb-8 text-center">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
            className="mx-auto mb-4 w-fit"
          >
            <BrandMark className="h-16 w-16 shadow-el-lg" />
          </motion.div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-ink">
            Cris Agent <span className="text-accent">Task</span>
          </h1>
          <p className="mt-1 text-sm text-mute">Panel personal de tareas</p>
        </div>

        <div className="card p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Contraseña</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <input
                  type="password"
                  required
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input pl-9"
                  autoComplete="current-password"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="btn-primary w-full"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              Entrar
            </button>
          </form>
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-faint">
          <ShieldCheck className="h-3.5 w-3.5" />
          App personal · acceso restringido
        </p>
      </motion.div>
    </div>
  );
}
