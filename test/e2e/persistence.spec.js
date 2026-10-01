import { test, expect, openApp, view, wmState } from "./fixtures.js";

test.describe("state survives a reload", () => {
  test("window layout (serialize/load), notes, tasks, theme and owner all come back", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-06-15T12:00:00Z"));
    await openApp(page);

    // app data
    await view(page, "notes").locator('kit--field[name="title"] input').fill("Remember me");
    await view(page, "notes").getByRole("button", { name: "Add note" }).click();
    await view(page, "tasks").locator('kit--field[name="label"] input').fill("Persist me");
    await view(page, "tasks").getByRole("button", { name: "Add task" }).click();
    await view(page, "settings").getByRole("button", { name: "Dark" }).click();
    // window state: close one, switch layout, float another
    await view(page, "data").getByRole("button", { name: "Close window: Data" }).click();
    await expect(page.locator("wm-view")).toHaveCount(3);
    await page.getByRole("button", { name: "Grid" }).click();
    await page.getByRole("button", { name: "Float window: Tasks" }).click();

    // what window-algebra serialized
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("workbench:wm")));
    expect(stored.version).toBeGreaterThan(0);
    expect(stored.windows.tasks.mode).toBe("floating");
    expect(Object.keys(stored.windows).sort()).toEqual(["notes", "settings", "tasks"]);

    await page.reload();
    await page.locator("html[data-components='ready']").waitFor({ state: "attached" });
    await page.locator("wm-view").first().waitFor();

    const state = await wmState(page);
    expect(state.windows.tasks.mode).toBe("floating");
    expect(state.workspaces[state.activeWorkspace].layout.type).toBe("grid");
    expect(Object.keys(state.windows).sort()).toEqual(["notes", "settings", "tasks"]);
    await expect(page.locator("wm-view")).toHaveCount(3);
    await expect(view(page, "tasks")).toHaveAttribute("data-mode", "floating");
    await expect(view(page, "notes").locator("wb--note-card h3")).toHaveText("Remember me");
    await expect(view(page, "tasks").locator("wb--task-item .label")).toHaveText("Persist me");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator('kit--button[data-layout="grid"]')).toHaveAttribute("pressed", "true");
  });

  test("a moved floating window comes back where it was left", async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.workbench.wm.move("settings", 321, 123));
    await expect.poll(async () => (await wmState(page)).windows.settings.placement).toMatchObject({ x: 321, y: 123 });
    await page.reload();
    await page.locator("wm-view").first().waitFor();
    expect((await wmState(page)).windows.settings.placement).toMatchObject({ x: 321, y: 123 });
  });

  test("a corrupt saved state is ignored and the app seeds itself", async ({ page }) => {
    await page.addInitScript(() => { if (!sessionStorage.seeded) { localStorage.setItem("workbench:wm", "{not json"); sessionStorage.seeded = "1"; } });
    await openApp(page);
    await expect(page.locator("wm-view")).toHaveCount(4);
  });

  test("undo and redo are available (history is on) and are persisted too", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Grid" }).click();
    await expect(page.locator("#status")).toContainText("layout grid");
    await page.evaluate(() => window.workbench.wm.undo());
    await expect(page.locator("#status")).toContainText("layout master-stack");
    await page.reload();
    await page.locator("wm-view").first().waitFor();
    await expect(page.locator("#status")).toContainText("layout master-stack");
  });
});
