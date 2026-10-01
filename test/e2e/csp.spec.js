import { test, expect, openApp } from "./fixtures.js";

test.describe("strict CSP with Trusted Types", () => {
  test("the page ships a meta CSP that requires Trusted Types and allows only the html-modules policy", async ({ page }) => {
    await openApp(page);
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(csp).toContain("trusted-types html-modules");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
    // the inline import map is allowed by hash, not by a nonce or 'unsafe-inline'
    const mapText = await page.locator('script[type="importmap"]').textContent();
    const hash = await page.evaluate(async (text) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return btoa(String.fromCharCode(...new Uint8Array(digest)));
    }, mapText);
    expect(csp).toContain(`'sha256-${hash}'`);
  });

  test("style-src is just 'self': no hashes, no 'unsafe-inline', and no style-src-elem report in any engine (html-modules#4)", async ({ page }) => {
    await openApp(page);
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(csp).toContain("style-src 'self';");
    expect(csp).not.toMatch(/style-src[^;]*sha256/);
    // every component module's <style> was parsed and stamped under that policy; a window that opens later too
    await page.getByRole("button", { name: "Float window: Tasks" }).click();
    await page.keyboard.press("ControlOrMeta+Shift+P");
    await page.keyboard.press("Escape");
    const reports = await page.evaluate(() => window.__violations.filter((v) => /^style-src/.test(v)));
    expect(reports).toEqual([]);
    // ... and the styles are really applied (a component's own <style> reached the shadow root)
    const padding = await page.locator("wb--notes-tool").first().evaluate((el) => getComputedStyle(el).paddingTop);
    expect(padding).not.toBe("0px");
    expect(await page.locator("style").count()).toBe(0);
  });

  test("nothing violated it while the app booted and ran", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Float window: Tasks" }).click();
    await page.keyboard.press("ControlOrMeta+Shift+P");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => window.__violations)).toEqual([]);
  });

  test("where the engine implements Trusted Types it is enforced: a string reaching an HTML sink throws", async ({ page, problems }, testInfo) => {
    await openApp(page);
    const supported = await page.evaluate(() => typeof window.trustedTypes?.createPolicy === "function");
    testInfo.annotations.push({ type: "trusted-types", description: supported ? "supported" : "UNSUPPORTED in this engine: the CSP directives are ignored, the app still runs" });
    console.log(`[trusted-types] ${testInfo.project.name}: ${supported ? "supported and enforced" : "unsupported (degrades gracefully)"}`);
    if (!supported) {
      // degrade gracefully: the app must work without Trusted Types
      await expect(page.locator("wm-view")).toHaveCount(4);
      return;
    }
    const outcome = await page.evaluate(() => {
      try { document.createElement("div").innerHTML = "<b>x</b>"; return "allowed"; } catch (e) { return e.name; }
    });
    expect(outcome).toBe("TypeError");
    // only the html-modules policy may be created: any other name is refused
    const other = await page.evaluate(() => {
      try { window.trustedTypes.createPolicy("evil", { createHTML: (s) => s }); return "created"; } catch (e) { return e.name; }
    });
    expect(other).toBe("TypeError");
    // the engine reported both refusals on the console; they are the point of this test
    await expect.poll(() => problems.length).toBeGreaterThanOrEqual(1);
    problems.splice(0);
    // html-modules went through its own policy: components are rendered
    await expect(page.locator("wb--notes-tool").first()).toBeVisible();
  });

  test("an injected inline script is refused", async ({ page, problems }) => {
    await openApp(page);
    const outcome = await page.evaluate(() => new Promise((resolve) => {
      let violation = null;
      document.addEventListener("securitypolicyviolation", (e) => { violation = e.violatedDirective; }, { once: true });
      const script = document.createElement("script");
      try { script.textContent = "window.__ran = true"; document.head.append(script); } catch (e) { resolve(`threw ${e.name}`); return; }
      setTimeout(() => resolve(window.__ran ? "ran" : `blocked ${violation ?? ""}`.trim()), 200);
    }));
    expect(outcome).not.toBe("ran");
    problems.splice(0); // the engine logs the refusal (TrustedScript or script-src), which is what we provoked
  });
});
