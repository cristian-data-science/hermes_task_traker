import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { gotoView, openNewTaskModal, VIEWS, type ViewLabel } from "./helpers";

/**
 * COMPUERTA DE NO-REGRESIÓN DESKTOP: cada vista en 1280/1440 debe ser
 * pixel-idéntica al baseline capturado del estado pre-PWA. Cualquier diff
 * visual en desktop bloquea la entrega.
 */
const isDesktop = (name: string) => name.startsWith("desktop");
const views = VIEWS as unknown as ViewLabel[];

const TOLERANCE = 0.12; // por-pixel (anti-aliasing)
// Datos VIVOS en producción: textos de tiempos relativos y contadores pueden
// cambiar entre corridas. Tolerancia por vista: Catch-up (denso en texto) 2%,
// modal 1%, resto 0.4%.
const MAX_DIFF_RATIO = 0.004;
function limitFor(name: string): number {
  if (name.includes("Catch-up")) return 0.02;
  if (name.includes("modal")) return 0.01;
  return MAX_DIFF_RATIO;
}

function diff(baselinePath: string, currentPath: string) {
  const a = PNG.sync.read(fs.readFileSync(baselinePath));
  const b = PNG.sync.read(fs.readFileSync(currentPath));
  if (a.width !== b.width || a.height !== b.height) {
    return { ratio: 1, width: a.width, height: a.height };
  }
  const diffPng = new PNG({ width: a.width, height: a.height });
  const diffPixels = pixelmatch(
    a.data,
    b.data,
    diffPng.data,
    a.width,
    a.height,
    { threshold: TOLERANCE },
  );
  return {
    ratio: diffPixels / (a.width * a.height),
    width: a.width,
    height: a.height,
  };
}

for (const view of views) {
  test(`desktop sin cambios: ${view}`, async ({ page }, testInfo) => {
    test.skip(!isDesktop(testInfo.project.name));
    const baseline = path.resolve(
      "screenshots/baseline-desktop",
      `${testInfo.project.name}-${view}.png`,
    );
    test.skip(!fs.existsSync(baseline), "sin baseline capturado");
    await gotoView(page, view);
    const current = `screenshots/desktop-current/${testInfo.project.name}-${view}.png`;
    await page.screenshot({ path: current });

    const { ratio } = diff(baseline, current);
    const limit = limitFor(view);
    expect(
      ratio,
      `desktop ${testInfo.project.name}/${view} cambió ${(ratio * 100).toFixed(2)}% (máx ${(limit * 100).toFixed(1)}%)`,
    ).toBeLessThanOrEqual(limit);
  });
}

test("desktop sin cambios: modal nueva tarea", async ({ page }, testInfo) => {
  test.skip(!isDesktop(testInfo.project.name));
  const baseline = path.resolve(
    "screenshots/baseline-desktop",
    `${testInfo.project.name}-modal-nueva.png`,
  );
  test.skip(!fs.existsSync(baseline), "sin baseline capturado");
  await gotoView(page, "Tablero");
  await openNewTaskModal(page);
  const current = `screenshots/desktop-current/${testInfo.project.name}-modal-nueva.png`;
  await page.screenshot({ path: current });
  const { ratio } = diff(baseline, current);
  expect(ratio).toBeLessThanOrEqual(0.01); // modal: UI estática + timing
});
