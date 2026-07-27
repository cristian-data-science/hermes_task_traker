import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Alias para resolver los tipos generados por Convex desde cualquier ruta
      "~/convex": fileURLToPath(new URL("./convex", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    fs: {
      strict: false,
      allow: [".."],
    },
  },
  optimizeDeps: {
    include: ["convex/server", "convex/browser", "convex/react"],
  },
  build: {
    commonjsOptions: {
      include: [/convex/, /node_modules/],
    },
  },
});
