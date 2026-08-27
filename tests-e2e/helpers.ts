import { expect, type Page } from "@playwright/test";

export const VIEWS = ["Tablero", "Lista", "Calendario", "Catch-up"] as const;
export type ViewLabel = (typeof VIEWS)[number];

/** Va a una vista del conmutador y espera que la app esté lista. */
export async function gotoView(page: Page, label: ViewLabel) {
  await page.goto("/");
  // En móvil la toolbar colapsa el texto de marca a solo-ícono (diseño
  // actual): la señal de "app cargada" es el header sticky en pie.
  await expect(page.locator("header").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700); // settle de framer-motion/data
}

/** Abre el modal de nueva tarea desde la toolbar. */
export async function openNewTaskModal(page: Page) {
  await page.getByRole("button", { name: /Nueva/ }).first().click();
  await expect(
    page.getByRole("heading", { name: "Nueva tarea" }),
  ).toBeVisible();
  await page.waitForTimeout(400);
}

/** Falla si el documento tiene overflow horizontal (el scroll debe quedar
 *  contenido en contenedores internos, p.ej. las columnas del kanban). */
export async function expectNoHorizontalOverflow(page: Page) {
  const { scrollW, clientW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  expect(scrollW, "overflow horizontal del documento").toBeLessThanOrEqual(
    clientW + 1,
  );
}

/** Screenshot con ruta determinística. */
export async function shot(page: Page, relPath: string) {
  await page.screenshot({ path: `screenshots/${relPath}`, fullPage: false });
}
