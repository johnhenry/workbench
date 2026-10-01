import { test, expect, openApp, view } from "./fixtures.js";

test.describe("data binding ({{attr}} and props) updates the DOM", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-06-15T12:00:00Z"));
    await openApp(page);
  });

  test("changing an attribute or property patches only the bound text", async ({ page }) => {
    const notes = view(page, "notes");
    await notes.locator('kit--field[name="title"] input').fill("Bound");
    await notes.getByRole("button", { name: "Add note" }).click();
    const card = notes.locator("wb--note-card");
    await expect(card.locator("h3")).toHaveText("Bound");

    const h3Handle = await card.locator("h3").elementHandle();
    await card.evaluate((el) => el.setAttribute("heading", "Renamed via attribute"));
    await expect(card.locator("h3")).toHaveText("Renamed via attribute");
    // the shadow DOM was patched in place, not re-created
    expect(await h3Handle.evaluate((node) => node.isConnected && node.textContent)).toBe("Renamed via attribute");
    // props: a typed property reflects to the attribute and back
    expect(await card.evaluate((el) => el.heading)).toBe("Renamed via attribute");
    await card.evaluate((el) => { el.heading = "Renamed via property"; });
    await expect(card).toHaveAttribute("heading", "Renamed via property");
    await expect(card.locator("h3")).toHaveText("Renamed via property");
    // binding into an attribute of an element in the template: aria-label of the delete button
    await expect(card.getByRole("button", { name: "Delete note Renamed via property" })).toBeVisible();
  });

  test("number props: the notes counter and the task counters follow the data", async ({ page }) => {
    const notes = view(page, "notes");
    const tool = notes.locator("wb--notes-tool");
    await expect(tool.locator(".count")).toHaveText("0 saved");
    expect(await tool.evaluate((el) => el.count)).toBe(0);
    for (const title of ["one", "two"]) {
      await notes.locator('kit--field[name="title"] input').fill(title);
      await notes.getByRole("button", { name: "Add note" }).click();
    }
    await expect(tool.locator(".count")).toHaveText("2 saved");
    expect(await tool.evaluate((el) => el.count)).toBe(2);

    const tasks = view(page, "tasks");
    await tasks.locator('kit--field[name="label"] input').fill("A");
    await tasks.getByRole("button", { name: "Add task" }).click();
    await tasks.locator('kit--field[name="label"] input').fill("B");
    await tasks.getByRole("button", { name: "Add task" }).click();
    const summary = tasks.locator("wb--tasks-tool .summary");
    await expect(summary).toContainText("2 open");
    await tasks.getByRole("button", { name: "Mark A as done" }).click();
    await expect(summary).toContainText("1 open");
    await expect(summary).toContainText("1 done");
    // the toggle button's aria-pressed is bound from the item's `pressed` attribute
    await expect(tasks.getByRole("button", { name: "Mark A as done" })).toHaveAttribute("aria-pressed", "true");
    await tasks.getByRole("button", { name: "Delete task B" }).click();
    await expect(summary).toContainText("0 open");
  });

  test("the data window's stats are bound to the window manager's state", async ({ page }) => {
    const data = view(page, "data");
    const stat = (label) => data.locator(`kit--stat[label="${label}"] .value`);
    await expect(stat("Windows")).toHaveText("4");
    await expect(stat("Tiled")).toHaveText("3");
    await expect(stat("Floating")).toHaveText("1");
    await page.getByRole("button", { name: "Float window: Tasks" }).click();
    await expect(stat("Floating")).toHaveText("2");
    await expect(stat("Tiled")).toHaveText("2");
    await view(page, "notes").getByRole("button", { name: "Close window: Notes" }).click();
    await expect(stat("Windows")).toHaveText("3");
    await expect(data.locator("wb--data-tool kit--badge").first()).toHaveText("master-stack");
    // and the log lists what just happened
    await expect(data.locator('wb--data-row[slot="events"]').filter({ hasText: "window/closed" })).toHaveCount(1);
  });

  test("the data window lists the import map the page runs on, with each entry's origin", async ({ page }) => {
    const rows = view(page, "data").locator('wb--data-row[slot="imports"]');
    await expect(rows).toHaveCount(8);
    await expect(rows.filter({ hasText: "dayjs/plugin/relativeTime" })).toContainText("cdn+sri");
    await expect(rows.filter({ hasText: "@johnhenry/window-algebra/browser" })).toContainText("local");
  });
});
