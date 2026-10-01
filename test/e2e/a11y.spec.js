import AxeBuilder from "@axe-core/playwright";
import { test, expect, openApp, settle, view } from "./fixtures.js";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

async function scan(page) {
  // The Data window fills after the page is "ready" (11 import-map rows now, so its body scrolls), and window-algebra's chrome marks
  // a scrolling body focusable from a ResizeObserver callback (W9). Look only once both have happened: scanning in between is a race
  // (WebKit on the CI runner lost it on every attempt once the import map grew).
  await page.locator('wm-view[data-view="data"] wb--data-row[slot="imports"]').first().waitFor();
  await settle(page);
  await settle(page);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  return { blocking, all: violations };
}
const summary = (list) => list.map((v) => `${v.impact} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")} (${v.help})`);

test.describe("axe: no serious or critical violations", () => {
  for (const scheme of ["light", "dark"]) {
    test(`the workbench, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openApp(page);
      const { blocking, all } = await scan(page);
      test.info().annotations.push({ type: "axe", description: `${all.length} violation(s) of any impact; ${blocking.length} serious/critical` });
      expect(summary(blocking)).toEqual([]);
    });
  }

  test("with the command palette open", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("ControlOrMeta+Shift+P");
    await expect(page.locator("[data-wm-palette]")).toBeVisible();
    expect(summary((await scan(page)).blocking)).toEqual([]);
  });

  test("with notes, tasks and a forced theme, right to left", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-06-15T12:00:00Z"));
    await openApp(page);
    await view(page, "notes").locator('kit--field[name="title"] input').fill("Accessible");
    await view(page, "notes").getByRole("button", { name: "Add note" }).click();
    await view(page, "tasks").locator('kit--field[name="label"] input').fill("Overdue");
    await view(page, "tasks").locator('kit--date-field[name="due"] input').fill("2026-06-01");
    await view(page, "tasks").getByRole("button", { name: "Add task" }).click();
    await view(page, "settings").getByRole("button", { name: "Right to left" }).click();
    await view(page, "settings").getByRole("button", { name: "Dark" }).click();
    expect(summary((await scan(page)).blocking)).toEqual([]);
  });

  test("the scan is real: a seeded violation is found (so the clean results above mean something)", async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      const img = document.createElement("img");
      img.src = "/favicon.svg";
      document.querySelector("main").append(img);
    });
    const { blocking } = await scan(page);
    expect(blocking.map((v) => v.id)).toContain("image-alt");
  });
});
