import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Mail, Lock, CheckCircle2, Sparkles } from "lucide-react";
import toast from "react-hot-toast";

/**
 * Pantalla de login con email + contraseña (auth segura en Convex).
 * Soporta registro y login.
 */
export function LoginScreen({
  signIn,
  signUp,
}: {
  signIn: (email: string, password: string) => Promise<unknown>;
  signUp: (email: string, password: string) => Promise<unknown>;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e?: React.FormEvent | React.MouseEvent) {
    e?.preventDefault();
    if (!email.trim() || !password) return;
    setSubmitting(true);
    try {
      if (mode === "signup") {
        await signUp(email.trim(), password);
        toast.success("Cuenta creada 🎉");
      } else {
        await signIn(email.trim(), password);
        toast.success("¡Bienvenido! 👋");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-50 via-white to-violet-50 px-4 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950">
      {/* Manchas decorativas */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 -top-20 h-72 w-72 rounded-full bg-indigo-400/30 blur-3xl dark:bg-indigo-600/20" />
        <div className="absolute -bottom-32 -right-20 h-96 w-96 rounded-full bg-violet-400/30 blur-3xl dark:bg-violet-600/20" />
        <div className="absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 rounded-full bg-sky-300/20 blur-3xl dark:bg-sky-600/10" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="relative w-full max-w-md"
      >
        {/* Logo */}
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
            Task Tracker · tu dashboard personal de tareas
          </p>
        </div>

        {/* Card */}
        <div className="card p-6 sm:p-8">
          {/* Toggle signin/signup */}
          <div className="mb-6 flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setMode("signin")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                mode === "signin"
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
              }`}
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                mode === "signup"
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
              }`}
            >
              Crear cuenta
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                  className="input pl-9"
                  autoComplete="email"
                />
              </div>
            </div>

            <div>
              <label className="label">
                Contraseña
                {mode === "signup" && (
                  <span className="ml-1 font-normal text-slate-400">(mín. 8)</span>
                )}
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input pl-9"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
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
              {mode === "signup" ? "Crear cuenta" : "Iniciar sesión"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500">
          🔒 Contraseñas hasheadas con PBKDF2 · sesión segura
        </p>
      </motion.div>
    </div>
  );
}
