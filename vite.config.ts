import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // PWA instalable en Android (WebAPK). El SW NO se registra en desktop:
    // main.tsx lo condiciona a pointer coarse / display-mode standalone para
    // garantizar que la experiencia web de escritorio quede intacta.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon-180x180.png"],
      manifest: {
        id: "/",
        name: "Hermes Task Tracker",
        short_name: "Hermes",
        description: "Panel personal de tareas en tiempo real",
        lang: "es",
        theme_color: "#010603",
        background_color: "#010603",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache del app-shell. Convex (WSS + HTTPS cross-origin) no pasa
        // por el SW: WSS no se intercepta por spec y el precache es
        // same-origin only. navigateFallback sirve el shell para SPA routes.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        // Tomar control de la página actual al activarse (si no, el primer
        // load no queda controlado y el offline-shell no responde hasta el
        // segundo reload).
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
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
