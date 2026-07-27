import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import App from "./App.tsx";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* ConvexAuthProvider ya incluye ConvexProvider internamente y maneja los
        tokens de autenticación. NO envolver con ConvexProvider adicional. */}
    <ConvexAuthProvider client={convex}>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 2500,
            style: {
              borderRadius: "10px",
              background: "#1e293b",
              color: "#f1f5f9",
              fontSize: "14px",
              border: "1px solid #334155",
            },
            success: { iconTheme: { primary: "#22c55e", secondary: "#fff" } },
            error: { iconTheme: { primary: "#ef4444", secondary: "#fff" } },
          }}
        />
      </QueryClientProvider>
    </ConvexAuthProvider>
  </StrictMode>,
);
