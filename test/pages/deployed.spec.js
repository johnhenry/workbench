import { test, expect } from "@playwright/test";

// The site as GitHub Pages serves it: under a subpath (/workbench/), the libraries copied into the artifact
// (vendor/), the real esm.sh for dayjs. Every URL below is relative to the baseURL, so the same file runs against
// the local copy of `npm run build:pages` and against the live site.

test.beforeEach(async ({ page }) => {
  page.problems = [];
  page.on("pageerror", (error) => page.problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") page.problems.push(`console.error: ${message.text()}`); });
  await page.addInitScript(() => {
    window.__pwned = [];
    window.__violations = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__violations.push(`${e.violatedDirective}: ${e.blockedURI || e.sample || "inline"}`));
  });
});
test.afterEach(async ({ page }) => { expect(page.problems, "errors on the page").toEqual([]); });

async function open(page) {
  await page.goto("./");
  await page.locator("html[data-ready='true'][data-components='ready']").waitFor({ state: "attached" });
  await expect(page.locator("wm-view")).toHaveCount(4);
}

test("boots at the subpath: the import map, the CSP and every module path carry the base", async ({ page, baseURL, request }) => {
  const base = new URL(baseURL).pathname;
  const responses = [];
  page.on("response", (r) => responses.push(`${r.status()} ${new URL(r.url()).pathname}`));
  await open(page);
  const map = await page.evaluate(() => JSON.parse(document.querySelector('script[type="importmap"]').textContent));
  const local = Object.values(map.imports).filter((url) => url.startsWith("/"));
  expect(local.length).toBeGreaterThanOrEqual(9);
  for (const url of local) {
    expect(url.startsWith(base), url).toBe(true);
    expect(url.includes("/node_modules/"), `${url} is served from the artifact, not node_modules`).toBe(false);
    if (!url.endsWith("/")) expect((await request.get(new URL(url, baseURL).href)).status(), url).toBe(200);
  }
  expect(map.imports["@workbench/ui/"]).toBe(`${base}components/`);
  expect(map.imports["@johnhenry/safe-fragment"]).toBe(`${base}vendor/@johnhenry/safe-fragment/dist/index.js`);
  expect(map.imports.dompurify).toBe(`${base}vendor/dompurify/dist/purify.es.mjs`); // added by mport's dependencies: true
  expect(map.imports.dayjs).toMatch(/^https:\/\/esm\.sh\//);
  expect(Object.keys(map.integrity).length).toBeGreaterThanOrEqual(4);
  expect(responses.filter((r) => /^(4|5)\d\d /.test(r))).toEqual([]);
  expect(await page.evaluate(() => window.__violations)).toEqual([]);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("require-trusted-types-for 'script'");
  expect(csp).toContain("trusted-types html-modules dompurify");
});

test("dayjs came from the real CDN and ran", async ({ page }) => {
  await open(page);
  await page.locator('wm-view[data-view="tasks"] kit--field[name="label"] input').fill("Deployed");
  await page.locator('wm-view[data-view="tasks"] kit--date-field[name="due"] input').fill("2020-01-01");
  await page.locator('wm-view[data-view="tasks"]').getByRole("button", { name: "Add task" }).click();
  await expect(page.locator('wm-view[data-view="tasks"] wb--task-item .due')).toContainText("years ago");
});

for (const force of [false, true]) {
  test(`safe-fragment on the deployed site (${force ? "DOMPurify forced: setHTML removed" : "the browser's engine"}): notes and the less-trusted module`, async ({ page }) => {
    await page.addInitScript((forceFallback) => { if (forceFallback) delete Element.prototype.setHTML; }, force);
    await page.route("**/broken.png", (route) => route.fulfill({ status: 200, contentType: "image/png", body: "not an image" }));
    await open(page);
    const notes = page.locator('wm-view[data-view="notes"]');
    await notes.locator('kit--field[name="title"] input').fill("Deployed XSS");
    await notes.locator('kit--area[name="body"] textarea').fill(
      `<p>fine <strong>bold</strong> <a href="https://example.com/">link</a></p>` +
      `<img src="broken.png" alt="x" onerror="window.__pwned.push('onerror')">` +
      `<a href="javascript:window.__pwned.push('href')">js</a><svg onload="window.__pwned.push('svg')"></svg>` +
      `<img alt="y" srcset="https://evil.example/a.png 1x"><script>window.__pwned.push('script')</script>`,
    );
    await notes.getByRole("button", { name: "Add note" }).click();
    const card = notes.locator("wb--note-card").first();
    await expect(card.locator(".body strong")).toHaveText("bold");
    await expect(card.locator("[data-report]")).toContainText("Sanitized (article-v1");
    const left = await card.evaluate((el) => {
      const nodes = [...el.shadowRoot.querySelectorAll(".body *")];
      return { bad: nodes.filter((n) => ["script", "svg", "iframe"].includes(n.localName)).length, handlers: nodes.flatMap((n) => [...n.attributes].filter((a) => /^on|^srcset$/i.test(a.name))).length, js: nodes.filter((n) => /^javascript:/i.test(n.getAttribute("href") ?? "")).length };
    });
    expect(left).toEqual({ bad: 0, handlers: 0, js: 0 });

    await page.getByRole("button", { name: "Clips", exact: true }).click();
    const clips = page.locator('wm-view[data-view="clips"]');
    await expect(clips.locator("clip--card h3")).toHaveText("A clip from elsewhere");
    await expect(clips.locator("wb--removal").first()).toBeVisible();
    const module = await clips.locator("clip--card").evaluate((el) => ({ script: el.shadowRoot.querySelectorAll("script, iframe, svg, form").length, handlers: [...el.shadowRoot.querySelectorAll("*")].flatMap((n) => [...n.attributes].filter((a) => /^on/i.test(a.name))).length }));
    expect(module).toEqual({ script: 0, handlers: 0 });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => [window.__pwned, window.__pwnedModule ?? []])).toEqual([[], []]);
    expect(await page.evaluate(() => window.__violations)).toEqual([]);
    const engine = await page.locator("#sanitizer").getAttribute("data-engine");
    if (force) expect(engine).toBe("dompurify");
    else expect(["native", "dompurify"]).toContain(engine);
    test.info().annotations.push({ type: "engine", description: engine });
  });
}
