import { test, expect, openApp, view, wmState } from "./fixtures.js";

test("the app boots with no console errors, no CSP or Trusted Types violations", async ({ page, context }) => {
  await openApp(page);
  await expect(page.locator("wm-view")).toHaveCount(4);
  for (const id of ["notes", "tasks", "data", "settings"]) await expect(view(page, id)).toBeVisible();
  expect(await page.evaluate(() => window.__violations)).toEqual([]);
  // the only things that left the machine are the dayjs files mport pinned, answered from fixtures
  expect(context.external.every((u) => u.startsWith("https://esm.sh/dayjs@"))).toBe(true);
  expect(context.external.length).toBeGreaterThan(0);
});

test("every tool window is made of html-modules components, and modules import a shared module", async ({ page }) => {
  await openApp(page);
  const tags = await page.evaluate(() =>
    ["wb--notes-tool", "wb--tasks-tool", "wb--data-tool", "wb--settings-tool", "kit--button", "kit--field", "kit--area", "kit--date-field", "kit--badge", "kit--stat"]
      .map((t) => [t, Boolean(customElements.get(t))]));
  expect(tags.filter(([, defined]) => !defined)).toEqual([]);
  // kit is imported by each tool module (module-imports-module): a button inside a tool's shadow root is upgraded
  for (const id of ["notes", "tasks", "data", "settings"]) {
    const upgraded = await view(page, id).locator("kit--button, kit--stat").first().evaluate((el) => el.matches(":defined") && Boolean(el.shadowRoot));
    expect(upgraded, id).toBe(true);
  }
  // the stylesheet export was adopted into the document
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--wb-gap").trim())).not.toBe("");
});

test("the window manager state is the one the page started with", async ({ page }) => {
  await openApp(page);
  const state = await wmState(page);
  expect(Object.keys(state.windows).sort()).toEqual(["data", "notes", "settings", "tasks"]);
  expect(state.workspaces[state.activeWorkspace].layout.type).toBe("master-stack");
  expect(state.windows.settings.mode).toBe("floating");
});
