import { test, expect, openApp, view, wmState } from "./fixtures.js";

const open = async (context) => {
  const page = await context.newPage();
  await openApp(page);
  return page;
};

test.describe("the stage owns the sync handle", () => {
  test("stage.sync is the attachSync handle, and the tab count reads stage.sync.peers()", async ({ context }) => {
    const a = await open(context);
    const shape = await a.evaluate(() => {
      const sync = document.querySelector("#stage").sync;
      return { same: sync === window.workbench.sync, peers: sync.peers().length, api: ["peers", "flush", "detach"].every((k) => typeof sync[k] === "function") };
    });
    expect(shape).toEqual({ same: true, peers: 0, api: true });
    const b = await open(context);
    await expect.poll(() => a.evaluate(() => document.querySelector("#stage").sync.peers().length)).toBe(1);
    await expect(b.locator("#sync")).toHaveText("Tabs: 2");
  });
});

test.describe("two tabs of one browser stay in step", () => {
  test("window changes cross over a BroadcastChannel; the tab count shows the peer", async ({ context }) => {
    const a = await open(context);
    const b = await open(context);
    await expect(a.locator("#sync")).toHaveAttribute("data-peers", "1");
    await expect(b.locator("#sync")).toHaveText("Tabs: 2");

    await a.getByRole("button", { name: "Float window: Tasks" }).click();
    await expect.poll(async () => (await wmState(b)).windows.tasks.mode).toBe("floating");
    await expect(view(b, "tasks")).toHaveAttribute("data-mode", "floating");

    await b.getByRole("button", { name: "Grid" }).click();
    await expect.poll(async () => (await wmState(a)).workspaces.main.layout.type).toBe("grid");
    await expect(a.locator("#status")).toContainText("layout grid");

    // closing a window in one closes it in the other
    await b.getByRole("button", { name: "Close window: Data" }).click();
    await expect(a.locator("wm-view")).toHaveCount(3);
    // undo in one tab propagates as well
    await b.evaluate(() => window.workbench.wm.undo());
    await expect(a.locator("wm-view")).toHaveCount(4);
  });

  test("a tab that opens later is brought up to date", async ({ context }) => {
    const a = await open(context);
    await a.getByRole("button", { name: "Grid" }).click();
    await a.getByRole("button", { name: "Float window: Tasks" }).click();
    const b = await open(context);
    expect((await wmState(b)).workspaces.main.layout.type).toBe("grid");
    expect((await wmState(b)).windows.tasks.mode).toBe("floating");
  });

  test("notes and tasks added in one tab appear in the other (storage events)", async ({ context }) => {
    const a = await open(context);
    const b = await open(context);
    await view(a, "notes").locator('kit--field[name="title"] input').fill("Shared note");
    await view(a, "notes").getByRole("button", { name: "Add note" }).click();
    await expect(view(b, "notes").locator("wb--note-card h3")).toHaveText("Shared note");
    await view(b, "tasks").locator('kit--field[name="label"] input').fill("Shared task");
    await view(b, "tasks").getByRole("button", { name: "Add task" }).click();
    await expect(view(a, "tasks").locator("wb--task-item .label")).toHaveText("Shared task");
    // and the theme
    await view(a, "settings").getByRole("button", { name: "Dark" }).click();
    await expect(b.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("a tab that leaves (pagehide) drops out of the other's count without anyone calling detach()", async ({ context }) => {
    const a = await open(context);
    const b = await open(context);
    await expect(a.locator("#sync")).toHaveAttribute("data-peers", "1");
    // navigating away fires pagehide in every engine (Playwright's WebKit does not fire it on page.close())
    await b.goto("about:blank");
    await expect(a.locator("#sync")).toHaveAttribute("data-peers", "0");
    await expect(a.locator("#sync")).toHaveText("Tabs: 1");
  });
});
