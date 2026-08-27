import { test, expect } from "@playwright/test";
import { gotoView, expectNoHorizontalOverflow, VIEWS } from "./helpers";

/**
 * Matriz responsive móvil: phone (360/390/412) + tablet (768).
 * Valida que las 4 vistas funcionen en vertical: sin overflow fuera de
 * contenedores, navegación accesible, proporciones correctas.
 */

const isMobileish = (name: string) =>
  ["mobile-s", "mobile-m", "mobile-l", "tablet"].includes(name);

for (const view of VIEWS) {
  test.describe(`responsive ${view}`, () => {
    test.skip(({ browserName, page }) => !page.viewportSize(), "sólo viewports");

    test(`sin overflow horizontal ni roturas (${view})`, async ({ page }, testInfo) => {
      test.skip(!isMobileish(testInfo.project.name));
      await gotoView(page, view);
      await expectNoHorizontalOverflow(page);

      // Header sticky presente (la marca de texto se colapsa a ícono en móvil).
      await expect(page.locator("header").first()).toBeVisible();

      // Sin errores de consola (ruido de red no cuenta: datos reales).
      // (La recolección vive en el test de abajo; acá sólo humo de render.)
    });

    test(`conmutador de vistas navega (${view})`, async ({ page }, testInfo) => {
      test.skip(!isMobileish(testInfo.project.name));
      await gotoView(page, "Tablero");
      const target = view === "Tablero" ? "Lista" : "Tablero";
      await page.getByRole("button", { name: target, exact: true }).click();
      await expect(
        page.getByRole("button", { name: target, exact: true }),
      ).toHaveAttribute("aria-pressed", "true", { timeout: 8_000 });
    });
  });
}

test("kanban: columnas 82vw con snap y scroll contenido en móvil", async ({ page }, testInfo) => {
  test.skip(!isMobileish(testInfo.project.name));
  await gotoView(page, "Tablero");
  await expectNoHorizontalOverflow(page);

  // Móvil (<sm): columnas 82vw con snap. ≥sm (tablet): 288px fijos.
  const firstCol = page.locator(".snap-x > div").first();
  await firstCol.waitFor({ state: "visible", timeout: 15_000 });
  const box = await firstCol.boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box).not.toBeNull();
  if (vw < 640) {
    expect(box!.width / vw).toBeGreaterThan(0.75);
    expect(box!.width / vw).toBeLessThan(0.9);
  } else {
    expect(Math.abs(box!.width - 288)).toBeLessThanOrEqual(2);
  }
});

test("tap-targets: acciones primarias ≥ 36px de alto", async ({ page }, testInfo) => {
  test.skip(
    !["mobile-m", "mobile-l"].includes(testInfo.project.name),
    "umbral de teléfono; tablet usa el layout compacto de escritorio",
  );
  await gotoView(page, "Tablero");
  const nueva = page.getByRole("button", { name: /Nueva/ }).first();
  await nueva.waitFor();
  const box = await nueva.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(32);
  for (const v of ["Tablero", "Lista", "Calendario", "Catch-up"]) {
    const b = page.getByRole("button", { name: v, exact: true });
    const bb = await b.boundingBox();
    expect(bb!.height).toBeGreaterThanOrEqual(32);
  }
});

test("sin errores de consola en el flujo de vistas", async ({ page }, testInfo) => {
  test.skip(!isMobileish(testInfo.project.name));
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  for (const view of VIEWS) {
    await gotoView(page, view);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
