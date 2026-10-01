import { test, openApp } from "./fixtures.js";
test.use({ hasTouch: true });
test("diag: what a tap produces", async ({ page, browserName }) => {
  await openApp(page);
  await page.evaluate(() => {
    window.__ev = [];
    for (const type of ["touchstart", "touchend", "pointerdown", "pointerup", "mousedown", "mouseup", "click"]) document.addEventListener(type, (e) => window.__ev.push(`${type}:${e.pointerType ?? ""}:${e.composedPath()[0]?.localName}`), true);
  });
  await page.getByRole("button", { name: "Grid" }).tap({ timeout: 3000 }).catch((e) => console.log("tap threw", String(e).slice(0, 120)));
  await page.waitForTimeout(500);
  console.log(`[diag] ${browserName} tap events:`, JSON.stringify(await page.evaluate(() => window.__ev)));
  await page.evaluate(() => { window.__ev.length = 0; });
  await page.touchscreen.tap(1000, 24);
  await page.waitForTimeout(300);
  console.log(`[diag] ${browserName} touchscreen.tap events:`, JSON.stringify(await page.evaluate(() => window.__ev)));
});
