import { test, expect } from "@playwright/test";

/**
 * Pantalla de login en móvil (contexto SIN sesión).
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("login móvil", () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

  test("dropzone visible con tap-target generoso e input file", async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await page.goto("/");
    await expect(fileInput).toBeAttached({ timeout: 15_000 });

    await expect(fileInput).toBeAttached();

    // El botón/zona de drop debe ser un tap-target generoso en teléfono.
    const dropzone = page
      .locator("button")
      .filter({ has: fileInput.or(page.locator("xpath=ancestor::button[1]")) })
      .first();
    const btn = (await dropzone.count()) > 0 ? dropzone : page.locator("button").first();
    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(120);
    expect(box!.width).toBeGreaterThanOrEqual(240);
  });
});

test.describe("login desktop baseline", () => {
  test("captura/gate del estado de login", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("desktop"));
    await page.goto("/");
    await expect(page.getByText(/Cris Agent Task/).first()).toBeVisible({ timeout: 15_000 });
    const name = `screenshots/${
      process.env.BASELINE ? "baseline-desktop" : "desktop-current"
    }/${testInfo.project.name}-login.png`;
    await page.screenshot({ path: name });
  });
});
