import { test, expect, openApp, view, wmState } from "./fixtures.js";

const SHORTCUT = "ControlOrMeta+Shift+P";
const dialog = (page) => page.locator("[data-wm-palette]");

test.describe("command palette", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test("opens with the shortcut, is a labelled combobox/listbox dialog, and closes on Escape", async ({ page }) => {
    await page.keyboard.press(SHORTCUT);
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAttribute("role", "dialog");
    const input = dialog(page).locator("input");
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("role", "combobox");
    expect(await dialog(page).locator('[role="option"]').count()).toBeGreaterThan(10);
    // it is styled by /styles/generated/wa.css (the CSP forbids the <style> it would inject)
    expect(await page.locator("style[data-wm-palette-style]").count()).toBe(0);
    expect(await page.locator("[data-wm-palette-backdrop]").evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
  });

  test("the Commands button opens it too", async ({ page }) => {
    await page.getByRole("button", { name: "Open command palette" }).click();
    await expect(dialog(page)).toBeVisible();
  });

  test("fuzzy filter, field prompt and dispatch: set the layout to columns", async ({ page }) => {
    await page.keyboard.press(SHORTCUT);
    await page.keyboard.type("set layout");
    const options = dialog(page).locator('[role="option"]');
    await expect(options.first()).toContainText(/layout/i);
    await page.keyboard.press("Enter");
    await page.keyboard.type("columns");
    await expect(options).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeHidden();
    await expect.poll(async () => (await wmState(page)).workspaces.main.layout.type).toBe("columns");
    await expect(page.locator("#status")).toContainText("layout columns");
  });

  test("create a window from the palette: it gets a generic html-modules component", async ({ page }) => {
    await page.keyboard.press(SHORTCUT);
    await page.keyboard.type("new window");
    await page.keyboard.press("Enter");
    await page.keyboard.type("scratch1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Scratchpad");
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeHidden();
    await expect(view(page, "scratch1")).toBeVisible();
    await expect(view(page, "scratch1").locator("wb--scratch")).toContainText("Scratchpad is an empty window");
    expect((await wmState(page)).windows.scratch1.title).toBe("Scratchpad");
  });

  test("close a window by name", async ({ page }) => {
    await page.keyboard.press(SHORTCUT);
    await page.keyboard.type("close window");
    await page.keyboard.press("Enter");
    await page.keyboard.type("data");
    await page.keyboard.press("Enter");
    await expect(view(page, "data")).toHaveCount(0);
    expect(Object.keys((await wmState(page)).windows)).not.toContain("data");
  });
});
