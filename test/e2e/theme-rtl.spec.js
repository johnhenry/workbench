import { test, expect, openApp, view, wmState } from "./fixtures.js";

const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const LIGHT = "rgb(244, 245, 247)"; // --wa-color-bg, light
const DARK = "rgb(16, 18, 22)"; // --wa-color-bg, dark

test.describe("theming (light and dark through the --wa-* tokens)", () => {
  test("follows the OS preference, then the settings window overrides it", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openApp(page);
    expect(await bg(page)).toBe(DARK);
    await expect(view(page, "settings").locator('kit--button[data-value="system"]')).toHaveAttribute("pressed", "true");

    await view(page, "settings").getByRole("button", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await bg(page)).toBe(LIGHT);
    await expect(view(page, "settings").locator('kit--button[data-value="light"]')).toHaveAttribute("pressed", "true");

    await view(page, "settings").getByRole("button", { name: "System" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    expect(await bg(page)).toBe(DARK);
  });

  test("dark mode reaches window chrome and the html-modules components inside shadow roots", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openApp(page);
    const measure = () => page.evaluate(() => {
      const tool = document.querySelector('wm-view[data-view="notes"] wb--notes-tool').shadowRoot;
      const button = tool.querySelector("kit--submit-button").shadowRoot.querySelector("button");
      const field = tool.querySelector("kit--field").shadowRoot.querySelector("input");
      return {
        win: getComputedStyle(document.querySelector('wm-view[data-view="tasks"] [data-wa-chrome]')).backgroundColor,
        button: getComputedStyle(button).color,
        field: getComputedStyle(field).backgroundColor,
      };
    });
    const light = await measure();
    await view(page, "settings").getByRole("button", { name: "Dark" }).click();
    const dark = await measure();
    expect(dark.win).not.toBe(light.win);
    expect(dark.button).not.toBe(light.button);
    expect(dark.field).not.toBe(light.field);
    expect(dark.win).toBe("rgb(26, 29, 35)"); // --wa-color-surface, dark
  });

  test("the choice is saved", async ({ page }) => {
    await openApp(page);
    await view(page, "settings").getByRole("button", { name: "Dark" }).click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("workbench:data")).settings.theme)).toBe("dark");
  });
});

test.describe("right to left", () => {
  test("the direction setting mirrors the whole stage: the master moves to the right", async ({ page }) => {
    await openApp(page);
    const xs = async () => Promise.all(["notes", "tasks"].map(async (id) => (await view(page, id).boundingBox()).x));
    const [n1, t1] = await xs();
    expect(n1).toBeLessThan(t1); // ltr: master on the left
    await view(page, "settings").getByRole("button", { name: "Right to left" }).click();
    await expect.poll(async () => (await wmState(page)).config.direction).toBe("rtl");
    await expect(page.locator("#stage [dir='rtl'], #stage[dir='rtl']").first()).toBeAttached();
    await expect(view(page, "settings").locator('kit--button[data-value="rtl"]')).toHaveAttribute("pressed", "true");
    await expect.poll(async () => { const [n, t] = await xs(); return n > t; }).toBe(true);
    // a floating window's x is measured from the right edge in rtl, and still lands inside the stage
    const stage = await page.locator("#stage").boundingBox();
    const settings = await view(page, "settings").boundingBox();
    expect(settings.x + settings.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
    // and back
    await view(page, "settings").getByRole("button", { name: "Left to right" }).click();
    await expect.poll(async () => { const [n, t] = await xs(); return n < t; }).toBe(true);
  });

  test("a page that is dir=rtl from the start follows it", async ({ page }) => {
    await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { document.documentElement.dir = "rtl"; }));
    await openApp(page);
    await expect.poll(async () => (await wmState(page)).config.direction).toBe("rtl");
  });

  test("the direction is part of the saved state", async ({ page }) => {
    await openApp(page);
    await view(page, "settings").getByRole("button", { name: "Right to left" }).click();
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("workbench:wm")).config.direction)).toBe("rtl");
    await page.reload();
    await page.locator("wm-view").first().waitFor();
    expect((await wmState(page)).config.direction).toBe("rtl");
  });
});
