import { test, expect } from "@playwright/test";

// mport's docs and example 12 print renderModulePreload() BEFORE renderImportMap(). This probes what each
// engine does with the two orders, on a synthetic page (no app involved), so the build can pick the safe one.
const modules = {
  "/lib.js": "export const value = 41;",
  "/main.js": 'import { value } from "lib"; window.RESULT = value + 1;',
};
const map = '<script type="importmap">{"imports":{"lib":"/lib.js"}}</script>';
const preload = '<link rel="modulepreload" href="/lib.js">';

async function run(page, head) {
  await page.route("http://probe.test/**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (modules[pathname]) return route.fulfill({ status: 200, contentType: "text/javascript", body: modules[pathname] });
    return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><head>${head}<script type="module" src="/main.js"></script></head><body></body></html>` });
  });
  await page.goto("http://probe.test/");
  await page.waitForTimeout(700);
  return page.evaluate(() => window.RESULT ?? null);
}

test("the import map first, then modulepreload: works in every engine (the order build.mjs writes)", async ({ page }) => {
  expect(await run(page, map + preload)).toBe(42);
});

test("modulepreload before the import map (the order in mport's docs): recorded per engine", async ({ page, browserName }) => {
  const result = await run(page, preload + map);
  test.info().annotations.push({ type: "preload-then-importmap", description: `${browserName}: ${result === 42 ? "works" : "BREAKS (the import map is ignored)"}` });
  console.log(`[order] ${browserName}: modulepreload-then-importmap ${result === 42 ? "works" : "BREAKS"}`);
  expect([42, null]).toContain(result);
});
