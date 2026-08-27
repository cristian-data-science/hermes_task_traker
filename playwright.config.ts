import { defineConfig, devices } from "@playwright/test";

/**
 * Suite e2e de Hermes Task Tracker.
 *
 * Dos compuertas:
 *  - Desktop NO-REGRESIÓN: pixel-diff 1280/1440 contra screenshots/baseline-desktop
 *    capturados del estado previo a la conversión PWA (BASELINE=1 regenera).
 *  - Mobile matrix: viewports verticales de teléfono/tablet validando responsive.
 *
 * El server local (vite preview del build de producción) lo levanta el propio
 * runner; Convex queda en producción y la sesión llega via storageState.
 */
export default defineConfig({
  testDir: "tests-e2e",
  outputDir: "test-results",
  timeout: 60_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4173",
    storageState: "tests-e2e/.auth/prod.json",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    locale: "es-CL",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npx vite preview --port 4173 --strictPort",
        url: "http://localhost:4173",
        reuseExistingServer: !process.env.E2E_REUSE === false,
        timeout: 30_000,
      },
  projects: [
    { name: "desktop-base", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "desktop-xl", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    {
      name: "mobile-s",
      use: { ...devices["Pixel 5"], viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true },
    },
    {
      name: "mobile-m",
      use: { ...devices["Pixel 7"], viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true },
    },
    {
      name: "mobile-l",
      use: { ...devices["Pixel 7"], viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true },
    },
    {
      name: "tablet",
      use: { ...devices["iPad Mini"], viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true },
    },
  ],
});
