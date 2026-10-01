import { test, openApp } from "./fixtures.js";
test.use({ hasTouch: true });
test("diag: taps on different targets", async ({ page, browserName }) => {
  await openApp(page);
  await page.evaluate(() => {
    window.__ev = [];
    for (const type of ["touchstart", "touchend", "pointerdown", "pointerup", "pointercancel", "mousedown", "mouseup", "click"]) addEventListener(type, (e) => window.__ev.push(`${type}:${e.composedPath()[0]?.localName}`), true);
  });
  const targets = {
    status: page.locator("#status"),
    wbTitleButton: page.getByRole("button", { name: "Float window: Data" }),
    kitInner: page.getByRole("button", { name: "Grid" }),
    kitHost: page.locator('kit--button[data-layout="grid"]'),
    kitHostAgain: page.locator('kit--button[data-layout="master-stack"]'),
  };
  for (const [name, loc] of Object.entries(targets)) {
    await page.evaluate(() => { window.__ev.length = 0; });
    const box = await loc.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    console.log(`[diag] ${browserName} ${name}:`, JSON.stringify(await page.evaluate(() => window.__ev)), await page.locator("#status").textContent());
  }
});
