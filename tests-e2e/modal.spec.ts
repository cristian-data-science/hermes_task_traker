import { test, expect } from "@playwright/test";
import { gotoView, openNewTaskModal, expectNoHorizontalOverflow } from "./helpers";

/**
 * Modal de nueva tarea en móvil: cabe en pantalla, footer accesible,
 * expandidor de notas funcional y picker de destino ClickUp presente.
 */
test.describe("modal móvil", () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

  test("abre, cabe en viewport y footer visible", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("mobile"));
    await gotoView(page, "Tablero");
    await openNewTaskModal(page);
    await expectNoHorizontalOverflow(page);

    const panel = page
      .getByRole("heading", { name: "Nueva tarea" })
      .locator("xpath=ancestor::div[contains(@class,'rounded-t-2xl') or contains(@class,'rounded-el-lg')][1]");
    const box = await panel.boundingBox();
    const vp = page.viewportSize()!;
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(-2);
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 2);

    // El footer con Guardar/Crear está en pantalla tras scroll al fondo.
    await page.getByRole("button", { name: /Crear tarea/ }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: /Crear tarea/ })).toBeInViewport();
  });

  test("expandidor de notas: 3 filas → 16 → 3 y persiste", async ({ page }) => {
    await gotoView(page, "Tablero");
    await openNewTaskModal(page);

    const notes = page.getByPlaceholder(/Detalles, criterios/);
    await expect(notes).toBeVisible();
    expect(await notes.evaluate((el: HTMLTextAreaElement) => el.rows)).toBe(3);

    await page.getByRole("button", { name: /Expandir/ }).click();
    expect(await notes.evaluate((el: HTMLTextAreaElement) => el.rows)).toBe(16);
    expect(
      await page.evaluate(() => localStorage.getItem("hermes-notes-expanded")),
    ).toBe("1");

    await page.getByRole("button", { name: /Contraer/ }).click();
    expect(await notes.evaluate((el: HTMLTextAreaElement) => el.rows)).toBe(3);
    expect(
      await page.evaluate(() => localStorage.getItem("hermes-notes-expanded")),
    ).toBe("0");
  });

  test("picker de destino ClickUp aparece para Patagonia", async ({ page }) => {
    test.setTimeout(60_000); // descubrimiento MCP puede tardar
    await gotoView(page, "Tablero");
    await openNewTaskModal(page);

    // SCOPED al panel: "Patagonia" también matchea chips/tarjetas del fondo.
    const panel = page
      .getByRole("heading", { name: "Nueva tarea" })
      .locator(
        'xpath=ancestor::div[contains(@class,"rounded-t-2xl") or contains(@class,"rounded-el-lg")][1]',
      );
    await panel.getByRole("button", { name: "Patagonia" }).click();
    await expect(panel.getByText("Destino ClickUp")).toBeVisible({
      timeout: 30_000,
    });
  });
});
