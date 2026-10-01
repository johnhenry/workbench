import { test, expect } from "@playwright/test";

// Not part of the gating suite: it needs the network and the real esm.sh. It proves that the integrity
// hashes mport recorded in the lockfile still match what the CDN serves today, and that the app boots on it.
test("boots against the real esm.sh, with every CDN file passing its integrity check", async ({ page }) => {
  const errors = [];
  const cdn = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { if (new URL(r.url()).hostname === "esm.sh") cdn.push(`${r.status()} ${r.url()}`); });
  await page.goto("/");
  await page.locator("html[data-ready='true'][data-components='ready']").waitFor({ state: "attached", timeout: 30_000 });
  await expect(page.locator("wm-view")).toHaveCount(4);
  expect(errors).toEqual([]);
  expect(cdn.length).toBeGreaterThanOrEqual(4);
  expect(cdn.every((line) => line.startsWith("200 "))).toBe(true);
  // dayjs really ran: a task due date is formatted by it
  await page.locator('wm-view[data-view="tasks"] kit--field[name="label"] input').fill("Real CDN");
  await page.locator('wm-view[data-view="tasks"] kit--date-field[name="due"] input').fill("2020-01-01");
  await page.locator('wm-view[data-view="tasks"]').getByRole("button", { name: "Add task" }).click();
  await expect(page.locator('wm-view[data-view="tasks"] wb--task-item .due')).toContainText("years ago");
});
