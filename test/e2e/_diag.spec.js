import { test, openApp } from "./fixtures.js";
test.use({ hasTouch: true });
test("diag: taps on shadow-DOM buttons", async ({ page, browserName }) => {
  await openApp(page);
  await page.evaluate(() => {
    window.__ev = [];
    for (const type of ["touchstart", "touchend", "pointerdown", "pointerup", "pointercancel", "mousedown", "mouseup", "click"]) addEventListener(type, (e) => window.__ev.push(`${type}:${e.composedPath()[0]?.localName}`), true);
    const make = (name, { delegatesFocus = false, slotted = true, hostCss = "", buttonCss = "" }) => {
      const host = document.createElement("div");
      host.id = name;
      host.style.cssText = `position:fixed;left:${40 + 120 * window.__n++}px;top:60px;width:110px;height:40px;background:#ccc;z-index:99999;${hostCss}`;
      const root = host.attachShadow({ mode: "open", delegatesFocus });
      const b = document.createElement("button");
      b.style.cssText = `width:100%;height:100%;${buttonCss}`;
      if (slotted) b.append(document.createElement("slot")); else b.textContent = "x";
      root.append(b);
      host.textContent = "label";
      document.body.append(host);
    };
    window.__n = 0;
    make("plain", {});
    make("delegates", { delegatesFocus: true });
    make("noslot", { slotted: false });
    make("noslot-delegates", { slotted: false, delegatesFocus: true });
  });
  for (const name of ["plain", "delegates", "noslot", "noslot-delegates"]) {
    await page.evaluate(() => { window.__ev.length = 0; });
    const box = await page.locator(`#${name}`).boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    console.log(`[diag] ${browserName} ${name}:`, JSON.stringify(await page.evaluate(() => window.__ev)));
  }
  // the real kit--button again, with its attribute changed
  await page.evaluate(() => { window.__ev.length = 0; });
  const info = await page.evaluate(() => { const k = document.querySelector('kit--button[data-layout="grid"]'); return { delegates: k.shadowRoot.delegatesFocus, touchAction: getComputedStyle(k.shadowRoot.querySelector("button")).touchAction, cursor: getComputedStyle(k.shadowRoot.querySelector("button")).cursor }; });
  console.log(`[diag] ${browserName} kit--button:`, JSON.stringify(info));
});
