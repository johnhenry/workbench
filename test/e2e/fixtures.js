import { readFile } from "node:fs/promises";
import { test as base, expect } from "@playwright/test";

const FIXTURES = new URL("../fixtures/cdn/", import.meta.url);
const index = JSON.parse(await readFile(new URL("index.json", FIXTURES), "utf8"));

/**
 * `test` for the workbench. Hermetic: every request that is not for the local server is answered from
 * recorded bytes (test/fixtures/cdn, the exact files mport hashed into the import map's `integrity`)
 * or refused. Every page also fails the test on a console error, an uncaught error, a CSP violation
 * or a Trusted Types violation.
 */
export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    const origin = new URL(baseURL).origin;
    context.external = [];
    await context.route((url) => url.origin !== origin, async (route) => {
      const url = route.request().url();
      const hit = index[url];
      context.external.push(url);
      if (!hit) return route.abort("blockedbyclient");
      await route.fulfill({
        status: 200,
        body: await readFile(new URL(hit.file, FIXTURES)),
        headers: { "content-type": hit.type, "access-control-allow-origin": "*", "cache-control": "no-store" },
      });
    });
    await use(context);
  },
  problems: async ({ context }, use) => {
    const problems = [];
    const watch = (page) => {
      page.on("pageerror", (error) => { if (!/ResizeObserver loop/.test(error.message)) problems.push(`pageerror: ${error.message}`); });
      page.on("console", (message) => { if (message.type() === "error") problems.push(`console.error: ${message.text()}`); });
    };
    context.on("page", watch);
    for (const page of context.pages()) watch(page);
    await use(problems);
    expect(problems, "errors on the page").toEqual([]);
  },
  page: async ({ page, problems }, use) => {
    void problems;
    await page.addInitScript(() => {
      window.__violations = [];
      document.addEventListener("securitypolicyviolation", (e) => window.__violations.push(`${e.violatedDirective}: ${e.blockedURI || e.sample || "inline"}`));
    });
    await use(page);
  },
});
export { expect };

/** Open the app and wait until the shell, the html-modules components and the tool windows are ready. */
export async function openApp(page, path = "/") {
  await page.goto(path);
  await page.locator("html[data-ready='true'][data-components='ready']").waitFor({ state: "attached" });
  await page.locator("wm-view").first().waitFor();
  return page;
}

export const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
export const wmState = (page) => page.evaluate(() => window.workbench.wm.getState());
