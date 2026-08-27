import { test, expect } from "@playwright/test";
import { gotoView, openNewTaskModal, shot, VIEWS, type ViewLabel } from "./helpers";

/**
 * CAPTURA DEL BASELINE DESKTOP (estado pre-PWA).
 * Sólo corre con BASELINE=1 y en projects desktop-*: `BASELINE=1 npx playwright test -g @baseline`.
 * No modificar sin regenerar el baseline a propósito.
 */

const isDesktop = (name: string) => name.startsWith("desktop");
const views = VIEWS.filter((v) => v !== "Catch-up").concat("Catch-up") as ViewLabel[];

test.describe("@baseline captura desktop", () => {
  test.skip(!!process.env.CI, "baseline sólo se genera a mano");

  for (const view of views) {
    test(`baseline ${view}`, async ({ page }, testInfo) => {
      test.skip(!isDesktop(testInfo.project.name) || !process.env.BASELINE);
      await gotoView(page, view);
      await shot(page, `baseline-desktop/${testInfo.project.name}-${view}.png`);
    });
  }

  test("baseline modal nueva tarea", async ({ page }, testInfo) => {
    test.skip(!isDesktop(testInfo.project.name) || !process.env.BASELINE);
    await gotoView(page, "Tablero");
    await openNewTaskModal(page);
    await shot(
      page,
      `baseline-desktop/${testInfo.project.name}-modal-nueva.png`,
    );
  });
});
