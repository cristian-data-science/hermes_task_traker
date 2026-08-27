import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

// Capturar errores globales. En producción no volcamos el stack completo
// (fuga de información de implementación); solo en desarrollo.
window.addEventListener("error", (e) => {
  if (import.meta.env.DEV) console.error("[GLOBAL ERROR]", e.message, e.error);
});
window.addEventListener("unhandledrejection", (e) => {
  if (import.meta.env.DEV) console.error("[UNHANDLED REJECTION]", e.reason);
});

/**
 * Service worker PWA — SOLO móvil/instalado.
 *
 * Restricción dura del proyecto: la web de escritorio queda intacta. El SW
 * cambia el comportamiento offline y de caché, así que solo se registra
 * cuando el contexto es de teléfono (pointer coarse) o la app ya corre
 * instalada (display-mode standalone). En desktop nunca se registra: misma
 * experiencia, misma red, cero SW.
 */
const isMobileLike =
  window.matchMedia("(pointer: coarse)").matches ||
  window.matchMedia("(display-mode: standalone)").matches;
if (isMobileLike) {
  registerSW({ immediate: true });
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 2500,
            style: {
              borderRadius: "var(--radius-lg)",
              background: "var(--surface-2)",
              color: "var(--text)",
              fontSize: "14px",
              fontFamily: "var(--font-sans)",
              border: "var(--bw) solid var(--border)",
              boxShadow: "var(--shadow-lg)",
            },
            success: {
              iconTheme: {
                primary: "var(--status-completado)",
                secondary: "var(--surface)",
              },
            },
            error: {
              iconTheme: {
                primary: "var(--danger)",
                secondary: "var(--surface)",
              },
            },
          }}
        />
      </QueryClientProvider>
    </ConvexProvider>
  </StrictMode>,
);
