import { test, expect, openApp, view, wmState } from "./fixtures.js";

// The window chrome is window-algebra's (`chrome: true` on <wa-stage>), not the app's.
test.describe("built-in window chrome", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test("every window has the library's title bar, named buttons, body and grips; the app ships none of it", async ({ page, request }) => {
    for (const id of ["notes", "tasks", "data", "settings"]) {
      const w = view(page, id);
      await expect(w.locator("[data-wa-chrome-title]")).toHaveText(await w.getAttribute("aria-label"));
      await expect(w.locator('[data-wm-handle="move"]')).toHaveCount(1);
      await expect(w.locator("[data-wa-chrome-body]")).toHaveCount(1);
      await expect(w.locator("[data-wm-handle^=resize-]")).toHaveCount(8);
      await expect(w.getByRole("button", { name: `Close window: ${await w.getAttribute("aria-label")}` })).toBeVisible();
    }
    expect(await page.locator(".wb-bar, .wb-win, .wb-btn, .wb-grip").count()).toBe(0);
    expect((await request.get("/app/chrome.js")).status()).toBe(404);
    // CHROME_CSS rides in the generated stylesheet with the --wa-chrome-* tokens
    const css = await (await request.get("/styles/generated/wa.css")).text();
    expect(css).toContain(".wa-chrome-bar");
    expect(css).toContain("--wa-chrome-bar-height");
    expect(await page.locator("#stage").evaluate((el) => el.renderer !== null && el.popouts === null)).toBe(true);
  });

  test("a tiled window maximizes and restores by mouse, and the title follows the state", async ({ page }) => {
    // regression: a click on Maximize of a tiled window left the Restore button hidden in Chromium (window-algebra 3fe88ea)
    await view(page, "data").getByRole("button", { name: "Maximize window: Data" }).click();
    await expect.poll(async () => (await wmState(page)).windows.data.status).toBe("maximized");
    await expect(view(page, "data").getByRole("button", { name: "Restore window: Data" })).toBeVisible();
    await view(page, "data").getByRole("button", { name: "Restore window: Data" }).click();
    await expect.poll(async () => (await wmState(page)).windows.data.status).not.toBe("maximized");
    await page.evaluate(() => window.workbench.wm.dispatch({ type: "window/set-title", id: "notes", title: "Jottings" }));
    await expect(view(page, "notes").locator("[data-wa-chrome-title]")).toHaveText("Jottings");
    await expect(view(page, "notes").getByRole("button", { name: "Close window: Jottings" })).toBeVisible();
  });

  test("a body that scrolls is a focusable, labelled region even though its content rendered after it mounted", async ({ page }) => {
    // regression: the Data window's components render after the surface mounts (window-algebra 3fe88ea; axe scrollable-region-focusable)
    const body = view(page, "data").locator("[data-wa-chrome-body]");
    await page.evaluate(() => window.workbench.wm.dispatch({ type: "window/set-mode", id: "data", mode: "floating" }));
    await page.evaluate(() => window.workbench.wm.dispatch({ type: "window/resize", id: "data", width: 320, height: 120 }));
    await expect(body).toHaveAttribute("tabindex", "0");
    await expect(body).toHaveAttribute("role", "region");
    await expect(body).toHaveAccessibleName("Data");
  });
});
