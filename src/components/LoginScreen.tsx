import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Lock, CheckCircle2, Sparkles } from "lucide-react";
import toast from "react-hot-toast";

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
      toast.success("¡Bienvenido! 👋");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-50 via-white to-violet-50 px-4 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 -top-20 h-72 w-72 rounded-full bg-indigo-400/30 blur-3xl dark:bg-indigo-600/20" />
        <div className="absolute -bottom-32 -right-20 h-96 w-96 rounded-full bg-violet-400/30 blur-3xl dark:bg-violet-600/20" />
        <div className="absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 rounded-full bg-sky-300/20 blur-3xl dark:bg-sky-600/10" />
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
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30"
          >
            <CheckCircle2 className="h-9 w-9 text-white" strokeWidth={2.5} />
          </motion.div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            Hermes
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Task Tracker
          </p>
        </div>

        <div className="card p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Contraseña</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
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
                <Sparkles className="h-4 w-4" />
              )}
              Entrar
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500">
          🔒 App personal · acceso restringido
        </p>
      </motion.div>
    </div>
  );
}
