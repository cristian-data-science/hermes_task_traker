import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, ArrowRight, ShieldCheck, FileKey2, UploadCloud } from "lucide-react";
import toast from "react-hot-toast";
import { BrandMark } from "./Toolbar";

/**
 * Pantalla de login por archivo de clave RSA (rsa_key.p8).
 *
 * El usuario arrastra (o selecciona) su clave privada. El navegador la usa para
 * firmar un challenge; la clave nunca se envía al servidor.
 */
export function LoginScreen({
  signIn,
}: {
  signIn: (file: File) => Promise<unknown>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setSubmitting(true);
    try {
      await signIn(file);
      toast.success("Bienvenido, Cristian");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "No se pudo verificar la clave";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  /** Filtra los archivos soltados: solo el primero, preferentemente .p8 / .pem. */
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
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
          <input
            ref={inputRef}
            type="file"
            accept=".p8,.pem,.key,text/plain,application/x-pem-file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              // reset para poder seleccionar el mismo archivo otra vez
              e.target.value = "";
            }}
          />

          {/* Zona de arrastrar y soltar la clave privada */}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            disabled={submitting}
            className={[
              "flex w-full flex-col items-center justify-center gap-3 rounded-el border-2 border-dashed p-8 text-center transition-colors",
              dragOver
                ? "border-accent bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
                : "border-line hover:border-accent/60 hover:bg-panel2",
            ].join(" ")}
          >
            {submitting ? (
              <Loader2 className="h-8 w-8 animate-spin text-accent" />
            ) : dragOver ? (
              <FileKey2 className="h-8 w-8 text-accent" />
            ) : (
              <UploadCloud className="h-8 w-8 text-mute" />
            )}
            <span className="text-sm font-medium text-ink">
              {submitting
                ? "Verificando clave…"
                : "Arrastra aquí tu archivo de clave"}
            </span>
            <span className="flex items-center gap-1 text-xs text-faint">
              o haz clic para seleccionar
            </span>
            <span className="mt-1 flex items-center gap-1 rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-mute">
              <FileKey2 className="h-3 w-3" />
              rsa_key.p8
            </span>
          </button>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-faint">
            <ArrowRight className="h-3.5 w-3.5" />
            La clave se usa solo en este navegador para firmar el acceso
          </p>
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-faint">
          <ShieldCheck className="h-3.5 w-3.5" />
          App personal · acceso por clave RSA
        </p>
      </motion.div>
    </div>
  );
}
