import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { motion } from "framer-motion";
import { Loader2, Mail, Lock, CheckCircle2, Sparkles } from "lucide-react";
import toast from "react-hot-toast";

/**
 * Pantalla de login.
 * Soporta email + contraseña y email mágico (código por correo) vía Convex Auth.
 */
export function LoginScreen() {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [flow, setFlow] = useState<"credentials" | "magic">("credentials");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      if (flow === "credentials") {
        const result = await signIn("password", {
          email,
          password,
          flow: mode === "signup" ? "signUp" : "signIn",
        });
        console.log("[auth] signIn result:", result);
        if (result.signingIn) {
          toast.success(mode === "signup" ? "Cuenta creada 🎉" : "¡Bienvenido!");
        } else {
          toast(
            mode === "signup"
              ? "Cuenta creada. Verifica tu email si se solicita."
              : "Revisa tu email para completar el login.",
          );
        }
      } else {
        // Email mágico: Convex Auth envía un código al correo
        await signIn("password", { email, flow: "magic" });
        toast.success("Te enviamos un código por correo 📧");
      }
    } catch (err) {
      console.error("[auth] signIn error:", err);
      toast.error(
        err instanceof Error ? err.message : "No se pudo iniciar sesión",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-50 via-white to-violet-50 px-4 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950">
      {/* Manchas decorativas de fondo */}
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
        {/* Logo / branding */}
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

        {/* Card del form */}
        <div className="card p-6 sm:p-8">
          {/* Toggle credentials / magic */}
          <div className="mb-6 flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setFlow("credentials")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                flow === "credentials"
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
              }`}
            >
              Contraseña
            </button>
            <button
              type="button"
              onClick={() => setFlow("magic")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                flow === "magic"
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
              }`}
            >
              Email mágico
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
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                  className="input pl-9"
                  autoComplete="email"
                />
              </div>
            </div>

            {flow === "credentials" && (
              <div>
                <label className="label">Contraseña</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="input pl-9"
                    autoComplete={
                      mode === "signup" ? "new-password" : "current-password"
                    }
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {mode === "signup"
                ? "Crear cuenta"
                : flow === "magic"
                  ? "Enviar código"
                  : "Iniciar sesión"}
            </button>
          </form>

          {flow === "credentials" && (
            <p className="mt-5 text-center text-sm text-slate-500 dark:text-slate-400">
              {mode === "signin" ? "¿No tienes cuenta?" : "¿Ya tienes cuenta?"}{" "}
              <button
                type="button"
                onClick={() =>
                  setMode((m) => (m === "signin" ? "signup" : "signin"))
                }
                className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
              >
                {mode === "signin" ? "Regístrate" : "Inicia sesión"}
              </button>
            </p>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500">
          Tus datos se guardan en Convex · plan gratuito
        </p>
      </motion.div>
    </div>
  );
}
