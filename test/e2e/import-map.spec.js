import { readFile } from "node:fs/promises";
import { test, expect, openApp } from "./fixtures.js";

const lock = JSON.parse(await readFile(new URL("../../mport.lock.json", import.meta.url), "utf8"));

test.describe("the import map mport generated", () => {
  test("is server-rendered ahead of every module script, with integrity for the CDN package's whole graph", async ({ page, request }) => {
    const html = await (await request.get("/")).text();
    const mapAt = html.indexOf('<script type="importmap">');
    const moduleAt = html.indexOf('<script type="module"');
    expect(mapAt).toBeGreaterThan(-1);
    expect(mapAt).toBeLessThan(moduleAt);
    const preloadAt = html.indexOf('<link rel="modulepreload"');
    expect(preloadAt).toBeGreaterThan(mapAt);

    await openApp(page);
    const map = await page.evaluate(() => JSON.parse(document.querySelector('script[type="importmap"]').textContent));
    expect(Object.keys(map.imports).sort()).toEqual([
      "@johnhenry/html-modules/browser", "@johnhenry/html-modules/runtime",
      "@johnhenry/window-algebra", "@johnhenry/window-algebra/browser", "@johnhenry/window-algebra/element",
      "@workbench/ui/", "dayjs", "dayjs/plugin/relativeTime",
    ]);
    // the three libraries are local (node_modules), the app's components are a prefix, dayjs is on the CDN
    expect(map.imports["@johnhenry/window-algebra"]).toBe("/node_modules/@johnhenry/window-algebra/src/index.mjs");
    expect(map.imports["@workbench/ui/"]).toBe("/components/");
    expect(map.imports.dayjs).toMatch(/^https:\/\/esm\.sh\/dayjs@\d+\.\d+\.\d+\?target=es2022$/);
    // integrity covers the entry stubs AND the real files they import (mport's `graph`), and equals the lockfile's
    expect(Object.keys(map.integrity)).toHaveLength(4);
    expect(map.integrity).toEqual(lock.files);
    expect(lock.packages["dayjs@^1.11"].integrity).toBe(map.integrity[map.imports.dayjs]);
  });

  test("every local entry is served, and dayjs came from the CDN stub", async ({ page, context, request }) => {
    await openApp(page);
    const map = await page.evaluate(() => JSON.parse(document.querySelector('script[type="importmap"]').textContent));
    for (const [key, url] of Object.entries(map.imports)) {
      if (!url.startsWith("/") || url.endsWith("/")) continue;
      const res = await request.get(url);
      expect(res.status(), key).toBe(200);
    }
    expect(context.external.filter((u) => u.includes("dayjs.mjs"))).not.toEqual([]);
  });

  test("an HTML module is loaded through a bare specifier that the import map resolves", async ({ page }) => {
    await openApp(page);
    const states = await page.evaluate(() => [...document.querySelectorAll("html-import")].map((el) => el.state));
    expect(states).toEqual(Array(6).fill("loaded"));
    const sources = await page.evaluate(() => [...document.querySelectorAll("html-import")].map((el) => el.getAttribute("src")));
    expect(sources.every((s) => s.startsWith("@workbench/ui/"))).toBe(true);
  });

  test("a CDN file that changed is refused by the engine (integrity from the import map)", async ({ page, problems }, testInfo) => {
    // serve different bytes for the one file the plugin imports
    await page.route("https://esm.sh/dayjs@*/es2022/plugin/relativeTime.mjs", (route) =>
      route.fulfill({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body: "export default () => {};" }));
    await page.goto("/");
    await page.waitForTimeout(1500);
    const booted = await page.evaluate(() => Boolean(window.workbench));
    testInfo.annotations.push({ type: "integrity", description: booted ? "NOT enforced in this engine" : "enforced" });
    expect(booted).toBe(false);
    expect(problems.join("\n")).toMatch(/integrity|digest|failed/i);
    problems.splice(0); // those are the errors we provoked
  });
});
