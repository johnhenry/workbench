import AxeBuilder from "@axe-core/playwright";
import { test, expect, openApp, view } from "./fixtures.js";

// @johnhenry/safe-fragment, two ways (README "safe-fragment"):
//   1. <safe-fragment profile="article-v1"> inside every note card: a note's body is untrusted rich text
//   2. html-modules' `sanitize` hook (safeFragmentSanitizer): the Clips tool loads components/untrusted/clip.html through it
// Each runs on the engine the browser has (Chromium and Firefox: the native Sanitizer API where it ships; WebKit: DOMPurify)
// AND with Element.prototype.setHTML removed, which forces the DOMPurify path on every engine. That path is the one that
// has to work under `require-trusted-types-for 'script'`, `trusted-types html-modules dompurify`.

const PAYLOAD = `
<h2>Release notes</h2>
<p>Plain <strong>bold</strong>, <em>italic</em> and <code>code</code>, with <a href="https://example.com/docs" target="_blank">a link</a>.</p>
<ul><li>first</li><li>second</li></ul>
<blockquote>quoted</blockquote>
<img src="/favicon.svg" alt="icon" onerror="window.__pwned.push('img onerror (good src)')">
<img src="/broken-1.png" alt="broken" onerror="window.__pwned.push('img onerror (broken src)')">
<img src="/broken-2.png" alt="broken too" onload="window.__pwned.push('img onload')">
<a href="javascript:window.__pwned.push('javascript: link')">click me</a>
<a href="  jAvA&#x09;scRipt:window.__pwned.push('obfuscated javascript: link')">click me too</a>
<a href="data:text/html,&lt;script&gt;window.__pwned.push('data: link')&lt;/script&gt;">data link</a>
<svg onload="window.__pwned.push('svg onload')" width="10" height="10"><circle r="4"/></svg>
<svg><a xlink:href="javascript:window.__pwned.push('svg xlink')"><text>x</text></a></svg>
<img src="/favicon.svg" alt="srcset" srcset="https://evil.example/leak.png 1x, javascript:window.__pwned.push('srcset') 2x">
<img srcset="/broken-3.png 1x, https://evil.example/leak2.png 2x" alt="srcset only">
<picture><source srcset="https://evil.example/leak3.png"><img src="/favicon.svg" alt="picture"></picture>
<script>window.__pwned.push('script')</script>
<iframe srcdoc="<script>parent.__pwned.push('iframe srcdoc')</script>"></iframe>
<object data="javascript:window.__pwned.push('object')"></object>
<form action="javascript:window.__pwned.push('form')"><button formaction="javascript:window.__pwned.push('formaction')">go</button><input autofocus onfocus="window.__pwned.push('input onfocus')"></form>
<div onclick="window.__pwned.push('onclick')" onmouseover="window.__pwned.push('onmouseover')">styled</div>
<noscript><p title="</noscript><img src=x onerror=window.__pwned.push('noscript')>"></p></noscript>
<meta http-equiv="refresh" content="0;url=https://evil.example/">
`;

const ENGINES = [
  { name: "the browser's own engine", force: false },
  { name: "DOMPurify (setHTML removed, as in WebKit)", force: true },
];

async function prepare(page, context, { force = false } = {}) {
  await page.addInitScript((forceFallback) => {
    window.__pwned = [];
    if (forceFallback) {
      delete Element.prototype.setHTML;
      delete ShadowRoot.prototype.setHTML;
      delete Document.setHTMLUnsafe;
    }
  }, force);
  // a real, undecodable image: it fires `error` (so an onerror that survived would run) without a 404 on the console
  await context.route("**/broken-*.png", (route) => route.fulfill({ status: 200, contentType: "image/png", body: "not an image" }));
}

async function addNote(page, title, body) {
  const notes = view(page, "notes");
  await notes.locator('kit--field[name="title"] input').fill(title);
  await notes.locator('kit--area[name="body"] textarea').fill(body);
  await notes.getByRole("button", { name: "Add note" }).click();
  return notes.locator("wb--note-card").first();
}

/** Everything in `root` that could carry code or load something it should not. */
const inspect = (root) => root.evaluate((el) => {
  const scope = el.shadowRoot ?? el;
  const all = [...scope.querySelectorAll("*")];
  const body = scope.querySelector(".body") ?? scope;
  const inBody = [...body.querySelectorAll("*")];
  return {
    tags: [...new Set(inBody.map((n) => n.localName))].sort(),
    handlers: inBody.flatMap((n) => [...n.attributes].filter((a) => /^on/i.test(a.name)).map((a) => `${n.localName}[${a.name}]`)),
    jsUrls: inBody.flatMap((n) => [...n.attributes].filter((a) => /^\s*(javascript|data|vbscript):/i.test(a.value.replace(/[\t\n\r]/g, ""))).map((a) => `${n.localName}[${a.name}]`)),
    srcsets: inBody.filter((n) => n.hasAttribute("srcset")).length,
    styled: inBody.filter((n) => n.hasAttribute("style")).length,
    hasStyleOrBase: all.some((n) => n.localName === "base" || n.localName === "meta" || (n.localName === "style" && body.contains(n))),
    html: body.innerHTML,
  };
});

for (const engine of ENGINES) {
  test.describe(`safe-fragment in the note cards: ${engine.name}`, () => {
    test.beforeEach(async ({ page, context }) => { await prepare(page, context, engine); });

    test("XSS payloads pasted into a note never execute, and the benign formatting survives", async ({ page, context }, testInfo) => {
      await openApp(page);
      const card = await addNote(page, "Pasted from a web page", PAYLOAD);
      const body = card.locator(".body");
      await expect(body.locator("strong")).toHaveText("bold"); // rendered (asynchronously, DOMPurify loads on demand)
      await expect(card.locator("[data-report]")).toContainText("removed");

      const found = await inspect(card);
      // the markup survived where the profile allows it
      expect(found.tags).toEqual(expect.arrayContaining(["h2", "p", "strong", "em", "code", "ul", "li", "blockquote", "a", "img"]));
      // ... and nothing that can carry code is left
      expect(found.tags).not.toEqual(expect.arrayContaining(["script"]));
      for (const bad of ["script", "iframe", "svg", "object", "form", "input", "button", "math", "style", "base", "meta", "source", "picture", "noscript", "mglyph"]) {
        expect(found.tags, bad).not.toContain(bad);
      }
      expect(found.handlers).toEqual([]);
      expect(found.jsUrls).toEqual([]);
      expect(found.srcsets).toBe(0);
      expect(found.styled).toBe(0);
      expect(found.hasStyleOrBase).toBe(false);
      const link = body.locator('a[href="https://example.com/docs"]');
      await expect(link).toHaveText("a link");
      await expect(link).toHaveAttribute("rel", /noopener/);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(body.locator('img[src="/favicon.svg"]').first()).toHaveAttribute("alt", "icon");

      // poke at what is left: the links, the images (they all fire load or error), the text
      // (dispatchEvent: the floating Settings window covers part of the notes window, and a real click would hit it)
      for (const anchor of await body.locator("a:not([href^='https:'])").all()) await anchor.dispatchEvent("click");
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => window.__pwned)).toEqual([]);
      // nothing asked for the attacker's host (a srcset that survived would have)
      expect(context.external.filter((u) => u.includes("evil.example"))).toEqual([]);
      // no CSP or Trusted Types report either: the sanitized DOM is built from nodes, and DOMPurify's policy is allowed
      expect(await page.evaluate(() => window.__violations)).toEqual([]);

      const status = await page.locator("#sanitizer").getAttribute("data-engine");
      testInfo.annotations.push({ type: "engine", description: `${testInfo.project.name}: ${status}` });
      expect(["native", "dompurify"]).toContain(status);
      if (engine.force) expect(status).toBe("dompurify");
    });

    test("the sanitizer report surfaces in the note card, and in the status bar", async ({ page }) => {
      await openApp(page);
      const dirty = await addNote(page, "Dirty", `<p>hi <img src="/favicon.svg" alt="x" onerror="window.__pwned.push(1)"></p><script>window.__pwned.push(2)</script><a href="javascript:window.__pwned.push(3)">j</a><svg onload="window.__pwned.push(4)"></svg><iframe srcdoc="x"></iframe>`);
      const report = dirty.locator("[data-report]");
      await expect(report).toContainText("Sanitized (article-v1");
      await expect(report).toContainText("removed");
      await expect(report).toContainText("<svg>"); // the one removal both engines can list
      const engineName = await page.locator("#sanitizer").getAttribute("data-engine");
      await expect(report).toContainText(`, ${engineName})`);
      if (engineName === "dompurify") {
        // DOMPurify lists everything it and the profile removed; the native engine's own removals (script, iframe, on*,
        // javascript: links) are not in its report (safe-fragment ADR 0007), which the card says
        for (const item of ["<script>", "<iframe>", "img[onerror]", "a[href]"]) await expect(report).toContainText(item);
      } else {
        await expect(report).toContainText("native engine's own removals are not listed");
      }
      await expect(page.locator("#sanitizer")).toHaveText(/^Sanitizer: (native|dompurify)$/);

      const clean = await addNote(page, "Clean", "<p>just <em>fine</em></p>");
      await expect(clean.locator(".body em")).toHaveText("fine");
      await expect(clean.locator("[data-report]")).toBeHidden(); // nothing removed: no report line
      // text with no markup in it is rendered as text (plain-text-v1), line breaks kept
      const text = await addNote(page, "Text", "line one\nline two & 1 < 2");
      await expect(text.locator("safe-fragment")).toHaveAttribute("profile", "plain-text-v1");
      await expect(text.locator(".body")).toHaveText("line one line two & 1 < 2");
      expect(await text.locator("safe-fragment").evaluate((el) => el.textContent)).toBe("line one\nline two & 1 < 2");
    });

    test("a hostile note that is already in localStorage is rendered safely after a reload", async ({ page }) => {
      await openApp(page);
      await addNote(page, "Stored", PAYLOAD);
      await expect(page.locator("wb--note-card [data-report]")).toContainText("removed");
      await page.reload();
      await page.locator("html[data-ready='true'][data-components='ready']").waitFor({ state: "attached" });
      const card = view(page, "notes").locator("wb--note-card");
      await expect(card.locator(".body strong")).toHaveText("bold");
      expect((await inspect(card)).handlers).toEqual([]);
      expect(await page.evaluate(() => window.__pwned)).toEqual([]);
      expect(await page.evaluate(() => window.__violations)).toEqual([]);
    });

    test("the less-trusted module's template is sanitized (html-modules sanitize hook + safeFragmentSanitizer)", async ({ page, context }) => {
      await openApp(page);
      await page.getByRole("button", { name: "Clips", exact: true }).click();
      const clips = view(page, "clips");
      const card = clips.locator("clip--card");
      await expect(card).toHaveCount(1);
      await expect(card.locator("h3")).toHaveText("A clip from elsewhere"); // the {{heading}} binding survived the sanitizer

      const found = await inspect(card);
      for (const bad of ["script", "iframe", "svg", "form", "input"]) expect(found.tags, bad).not.toContain(bad);
      expect(found.tags).toEqual(expect.arrayContaining(["h3", "p", "strong", "em", "a", "img"]));
      expect(found.handlers).toEqual([]);
      expect(found.jsUrls).toEqual([]);
      expect(found.styled).toBe(0);
      await expect(card.locator('a[href="https://example.com/clip"]')).toHaveAttribute("rel", /noopener/);
      await expect(card.locator('img[src="favicon.svg"]')).toHaveCount(1);
      // the module's own <style> export is not sanitized and still applies
      expect(await card.evaluate((el) => getComputedStyle(el.shadowRoot.querySelector("h3")).borderBottomStyle)).toBe("dashed");

      await card.locator("a:not([href^='https:'])").first().dispatchEvent("click");
      await card.locator("p").last().dispatchEvent("click");
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => window.__pwnedModule ?? [])).toEqual([]);
      expect(await page.evaluate(() => window.__pwned)).toEqual([]);

      // the sanitizer's report is listed in the tool
      const rows = clips.locator("wb--removal");
      await expect(rows.first()).toBeVisible();
      const names = await rows.evaluateAll((els) => els.map((el) => el.getAttribute("name")));
      // what the adapter lists depends on the engine (the native one cannot list its own removals): <svg> is in both
      expect(names).toContain("<svg>");
      if (await page.locator("#sanitizer").getAttribute("data-engine") === "dompurify") {
        expect(names).toEqual(expect.arrayContaining(["<script>", "<iframe>", "img[onerror]", "a[href]", "p[onclick]"]));
      }
      await expect(clips.locator("wb--clips-tool")).toHaveAttribute("removed", String(names.length));
      expect(context.external.filter((u) => u.includes("evil.example"))).toEqual([]);
      expect(await page.evaluate(() => window.__violations)).toEqual([]);
      // the import itself: made in script, sanitized, loaded
      const state = await page.evaluate(() => {
        const el = [...document.querySelectorAll("html-import")].find((n) => n.getAttribute("src").includes("untrusted"));
        return { state: el.state, sanitize: typeof el.sanitize };
      });
      expect(state).toEqual({ state: "loaded", sanitize: "function" });
    });

    test("input with style=, <style> or <base> is sanitized too; Chromium reports its parse as CSP violations (safe-fragment#13)", async ({ page, problems }) => {
      await openApp(page);
      const card = await addNote(page, "Parse-time", `<p style="background:url(https://evil.example/css.png)" onclick="window.__pwned.push('onclick')">styled <strong>text</strong></p><style>p{background:url(https://evil.example/s.png)}</style><base href="https://evil.example/"><math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=window.__pwned.push('mxss')&gt;"></mglyph></table></mtext></math>`);
      await expect(card.locator(".body strong")).toHaveText("text");
      const found = await inspect(card);
      expect(found.styled).toBe(0);
      expect(found.hasStyleOrBase).toBe(false);
      expect(found.handlers).toEqual([]);
      await card.locator(".body p").dispatchEvent("click");
      expect(await page.evaluate(() => window.__pwned)).toEqual([]);
      // Chromium reports the parse itself (style-src-attr, style-src-elem, base-uri) although nothing is applied; WebKit does not.
      // Pin the whole set: no script-src, img-src or require-trusted-types-for report may ever appear here.
      const violations = await page.evaluate(() => window.__violations);
      expect(violations.filter((v) => !/^(style-src-attr|style-src-elem|base-uri):/.test(v))).toEqual([]);
      problems.splice(0); // the console lines for exactly those reports
    });

    test("axe stays clean with rich notes and the Clips window open", async ({ page }) => {
      await openApp(page);
      await addNote(page, "Rich", PAYLOAD);
      await page.getByRole("button", { name: "Clips", exact: true }).click();
      await expect(view(page, "clips").locator("wb--removal").first()).toBeVisible();
      await expect(view(page, "notes").locator("wb--note-card .body strong")).toBeVisible();
      for (const scheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme: scheme });
        const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
        const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(blocking.map((v) => `${v.impact} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`), scheme).toEqual([]);
      }
      expect(await page.evaluate(() => window.__violations)).toEqual([]);
    });
  });
}

test.describe("safe-fragment is the defence, not the CSP", () => {
  test("with the page's CSP removed, the payloads still do not run and nothing asks for the attacker's host", async ({ page, context }) => {
    await prepare(page, context);
    await page.route("**/", async (route) => {
      const response = await route.fetch();
      const html = (await response.text()).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "");
      expect(html).not.toContain("Content-Security-Policy");
      await route.fulfill({ response, body: html });
    });
    await openApp(page);
    expect(await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]'))).toBeNull();
    const card = await addNote(page, "No CSP", PAYLOAD);
    await expect(card.locator(".body strong")).toHaveText("bold");
    await page.getByRole("button", { name: "Clips", exact: true }).click();
    await expect(view(page, "clips").locator("wb--removal").first()).toBeVisible();
    await view(page, "clips").locator("clip--card p").last().dispatchEvent("click");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => [window.__pwned, window.__pwnedModule ?? []])).toEqual([[], []]);
    expect((await inspect(card)).handlers).toEqual([]);
    expect(context.external.filter((u) => u.includes("evil.example"))).toEqual([]);
  });

  test("the control: the same payload IS dangerous without safe-fragment (the test would notice)", async ({ page, context }) => {
    await prepare(page, context);
    await page.route("**/", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "") });
    });
    await openApp(page);
    // what a naive note card would do: parse the string into the DOM (no CSP here, so no Trusted Types either)
    await page.evaluate(() => {
      const div = document.createElement("div");
      div.innerHTML = '<img src="/broken-9.png" onerror="window.__pwned.push(\'naive innerHTML\')">';
      document.body.append(div);
    });
    await expect.poll(() => page.evaluate(() => window.__pwned)).toEqual(["naive innerHTML"]);
  });
});
