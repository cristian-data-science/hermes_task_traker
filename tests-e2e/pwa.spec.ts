import { test, expect } from "@playwright/test";

/**
 * PWA: manifest, iconos, theme-color y Service Worker.
 *
 * Guard de scoping: el SW debe registrarse SOLO en móvil (pointer coarse);
 * en desktop el registro debe seguir siendo null (web intacta).
 */
const MANIFEST_PATH = "/manifest.webmanifest";
const THEME_COLOR = "#010603";

test("manifest servido y parseable con iconos obligatorios", async ({ request }) => {
  const res = await request.get(MANIFEST_PATH);
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest.name).toContain("Hermes");
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/");
  const sizes = manifest.icons.map((i: any) => i.sizes);
  expect(sizes).toContain("192x192");
  expect(sizes).toContain("512x512");
  expect(manifest.icons.some((i: any) => i.purpose?.includes("maskable"))).toBe(true);
});

test("iconos PWA responden 200", async ({ request }) => {
  for (const icon of ["pwa-192x192.png", "pwa-512x512.png", "maskable-icon-512x512.png"]) {
    const res = await request.get(`/${icon}`);
    expect(res.status(), icon).toBe(200);
  }
});

test("theme-color meta presente", async ({ page }) => {
  await page.goto("/");
  const content = await page
    .locator('meta[name="theme-color"]')
    .getAttribute("content");
  expect(content?.toLowerCase()).toBe(THEME_COLOR);
});

test("desktop: SIN service worker registrado (web intacta)", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("desktop"));
  await page.goto("/");
  await page.waitForTimeout(2_500);
  const hasSW = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg;
  });
  expect(hasSW).toBe(false);
});

test("móvil: service worker registrado y activo", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"));
  await page.goto("/");
  const hasSW = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.active) return true;
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  });
  expect(hasSW).toBe(true);
});

test.describe("móvil: smoke offline (sin token — el login renderiza desde precache)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("el app-shell precacheado responde", async ({ page, context }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"));
  await page.goto("/");
  // Esperar SW activo antes de cortar la red.
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    return !!reg?.active;
  }, undefined, { timeout: 15_000 });

  // Patrón estándar PWA: reload ONLINE para que el SW tome control de la
  // página, recién ahí cortar la red y recargar (el precache responde).
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, {
    timeout: 15_000,
  });
  await context.setOffline(true);
  await page.reload();
  // Offline la sesión no puede verificarse: sin token el shell muestra el
  // login — prueba que el precache respondió (no el dino de Chrome).
  await expect(page.getByText(/Arrastra aquí tu archivo de clave/)).toBeVisible({
    timeout: 12_000,
  });
    await context.setOffline(false);
  });
});
