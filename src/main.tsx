import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
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
