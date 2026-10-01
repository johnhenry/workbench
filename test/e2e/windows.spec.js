import { test, expect, openApp, settle, view, wmState } from "./fixtures.js";

const handle = (page, id) => view(page, id).locator('[data-wm-handle="move"]');
const order = async (page) => {
  const state = await wmState(page);
  return state.workspaces[state.activeWorkspace].windows.filter((id) => state.windows[id].mode !== "floating"); // the tiled ones
};

test.describe("windows: open, move, dock", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test("a closed tool reopens from the header; focus follows", async ({ page }) => {
    await view(page, "notes").getByRole("button", { name: "Close window: Notes" }).click();
    await expect(page.locator("wm-view")).toHaveCount(3);
    expect(Object.keys((await wmState(page)).windows)).not.toContain("notes");
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await expect(page.locator("wm-view")).toHaveCount(4);
    await expect(view(page, "notes").locator("wb--notes-tool")).toBeVisible();
    expect((await wmState(page)).focus.window).toBe("notes");
    await expect(page.locator("#status")).toContainText("4 windows");
  });

  test("a tiled window floats from its title bar, moves by dragging, and docks back", async ({ page }) => {
    const id = "tasks";
    await page.getByRole("button", { name: "Float window: Tasks" }).click();
    await expect.poll(async () => (await wmState(page)).windows[id].mode).toBe("floating");
    await expect(view(page, id)).toHaveAttribute("data-mode", "floating");
    await expect(page.getByRole("button", { name: "Dock window: Tasks" })).toHaveAttribute("aria-pressed", "true");
    const before = await view(page, id).boundingBox();

    // drag the title bar: a floating window follows the pointer
    const bar = await handle(page, id).boundingBox();
    await page.mouse.move(bar.x + 60, bar.y + bar.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x + 160, bar.y + 90, { steps: 8 });
    await page.mouse.move(bar.x + 200, bar.y + 120, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    const after = await view(page, id).boundingBox();
    expect(Math.round(after.x - before.x)).toBeGreaterThan(100);
    expect(Math.round(after.y - before.y)).toBeGreaterThan(60);
    const placement = (await wmState(page)).windows[id].placement;
    expect(Math.abs(placement.x - (after.x - (await page.locator("#stage").boundingBox()).x))).toBeLessThan(40);

    // dock it back into the layout
    await page.getByRole("button", { name: "Dock window: Tasks" }).click();
    await expect.poll(async () => (await wmState(page)).windows[id].mode).not.toBe("floating");
    await expect(view(page, id)).not.toHaveAttribute("data-mode", "floating");
    expect(await order(page)).toContain(id);
  });

  test("dragging a tiled window onto another's edge docks it there, as one undo step", async ({ page }) => {
    const [first, second, third] = await order(page);
    expect([first, second, third].every(Boolean)).toBe(true);
    const from = await handle(page, first).boundingBox();
    const target = await view(page, third).boundingBox();
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 80, from.y + from.height / 2 + 20, { steps: 4 });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height - 12, { steps: 14 });
    await expect(page.locator("[data-wm-drop-zone]")).toHaveCount(1); // the preview shows where it will land
    await page.mouse.up();
    await settle(page);
    const now = await order(page);
    expect(now).not.toEqual([first, second, third]);
    expect([...now].sort()).toEqual([first, second, third].sort());
    await page.evaluate(() => window.workbench.wm.undo());
    expect(await order(page)).toEqual([first, second, third]);
  });

  test("maximize and restore from the title bar", async ({ page }) => {
    await view(page, "data").getByRole("button", { name: "Maximize window: Data" }).click();
    await expect.poll(async () => (await wmState(page)).windows.data.status).toBe("maximized");
    await view(page, "data").getByRole("button", { name: "Restore window: Data" }).click();
    await expect.poll(async () => (await wmState(page)).windows.data.status).not.toBe("maximized");
  });

  test("two layouts: master-stack and grid", async ({ page }) => {
    const tiled = ["notes", "tasks", "data"];
    const box = async (id) => view(page, id).boundingBox();
    // master-stack: the master is tall on the left, the others stack on the right
    const [n1, t1] = [await box("notes"), await box("tasks")];
    expect(n1.height).toBeGreaterThan(t1.height * 1.5);
    expect(t1.x).toBeGreaterThan(n1.x);
    await page.getByRole("button", { name: "Grid" }).click();
    await expect(page.locator("#status")).toContainText("layout grid");
    await expect(page.locator('kit--button[data-layout="grid"]')).toHaveAttribute("pressed", "true");
    await settle(page);
    const boxes = await Promise.all(tiled.map(box));
    // a grid of three: equal-sized cells
    expect(Math.abs(boxes[0].height - boxes[1].height)).toBeLessThan(4);
    expect(Math.abs(boxes[0].width - boxes[1].width)).toBeLessThan(4);
    await page.getByRole("button", { name: "Master", exact: true }).click();
    await expect(page.locator("#status")).toContainText("layout master-stack");
  });

  test("keyboard: Alt+Shift+Arrow moves the focused floating window", async ({ page }) => {
    await handle(page, "settings").click({ position: { x: 20, y: 10 } });
    await expect.poll(async () => (await wmState(page)).focus.window).toBe("settings");
    const before = (await wmState(page)).windows.settings.placement;
    await view(page, "settings").locator(".wb-body").focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("Alt+Shift+ArrowRight");
    await expect.poll(async () => (await wmState(page)).windows.settings.placement.x).toBeGreaterThan(before.x + 20);
    await page.keyboard.press("Alt+Shift+ArrowDown");
    await expect.poll(async () => (await wmState(page)).windows.settings.placement.y).toBeGreaterThan(before.y);
  });
});
