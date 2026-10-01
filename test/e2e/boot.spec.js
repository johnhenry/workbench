import { test, expect, openApp, wmState } from "./fixtures.js";

test("the app boots with no console errors, no CSP or Trusted Types violations", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("wm-view")).toHaveCount(4);
  expect(await page.evaluate(() => window.__violations)).toEqual([]);
});
