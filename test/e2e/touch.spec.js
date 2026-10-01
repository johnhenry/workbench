import { test, expect, openApp, settle, view, wmState } from "./fixtures.js";

// Chromium is driven with real touch events over CDP. Firefox and WebKit have no touch automation for
// gestures, so there the same pointer streams are dispatched as PointerEvents with pointerType "touch"
// (real events through the real DOM and layout, without the engine's gesture arbitration).
test.use({ hasTouch: true });

const makeTouch = async (page, browserName) => {
  if (browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    const send = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
    return { start: (p) => send("touchStart", p), move: (p) => send("touchMove", p), end: () => send("touchEnd", []) };
  }
  const fire = (type, id, x, y) => page.evaluate(([type, id, x, y]) => {
    window.__touch ??= new Map();
    let target = window.__touch.get(id);
    if (type === "pointerdown" || !target?.isConnected) target = document.elementFromPoint(x, y) ?? document.body;
    if (type === "pointerdown") window.__touch.set(id, target);
    if (type === "pointerup") window.__touch.delete(id);
    target.dispatchEvent(new PointerEvent(type, { pointerId: id + 1, pointerType: "touch", isPrimary: id === 0, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
  }, [type, id, x, y]);
  let down = [];
  return {
    start: async (points) => { down = points; for (const [i, [x, y]] of points.entries()) await fire("pointerdown", i, x, y); },
    move: async (points) => { down = points; for (const [i, [x, y]] of points.entries()) await fire("pointermove", i, x, y); },
    end: async () => { for (const [i, [x, y]] of down.entries()) await fire("pointerup", i, x, y); down = []; },
  };
};

// locator.tap() in Playwright's Firefox delivered only pointer events for the first tap of a page (no touch
// events, no click); touchscreen.tap() at the element's centre delivers the whole sequence in every engine.
const tap = async (page, locator) => {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
};

test.describe("touch", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await tap(page, page.locator("#status")); // a first touch on an inert spot
  });

  test("tapping the window chrome works in every engine", async ({ page }) => {
    await tap(page, page.getByRole("button", { name: "Float window: Data" }));
    await expect.poll(async () => (await wmState(page)).windows.data.mode).toBe("floating");
    await tap(page, page.getByRole("button", { name: "Dock window: Data" }));
    await expect.poll(async () => (await wmState(page)).windows.data.mode).not.toBe("floating");
  });

  test("tapping the html-modules buttons works (Firefox: see the note)", async ({ page, browserName }) => {
    // In Playwright's Firefox a tap whose hit target is the <slot> inside a <button> in a shadow root delivers
    // pointerdown/pointerup and nothing else (no touch events, no click). Measured with plain shadow-DOM buttons
    // that have no html-modules or window-algebra code, so it is the engine or its automation, not this app.
    // A <button> whose text is a direct child of the shadow root (no <slot>) is tapped fine. Taps on kit--button
    // are therefore asserted in Chromium and WebKit only.
    test.skip(browserName === "firefox", "touch tap on a <slot> inside a shadow <button> produces only pointer events in Playwright's Firefox");
    await tap(page, page.getByRole("button", { name: "Grid" }));
    await expect(page.locator("#status")).toContainText("layout grid");
    await tap(page, page.getByRole("button", { name: "Open command palette" }));
    await expect(page.locator("[data-wm-palette]")).toBeVisible();
  });

  test("a finger drags a floating window by its title bar", async ({ page, browserName }) => {
    const touch = await makeTouch(page, browserName);
    const bar = await view(page, "settings").locator('[data-wm-handle="move"]').boundingBox();
    const before = (await wmState(page)).windows.settings.placement;
    const [x, y] = [bar.x + 60, bar.y + bar.height / 2];
    await touch.start([[x, y]]);
    for (let i = 1; i <= 8; i++) await touch.move([[x + 12 * i, y + 5 * i]]);
    await touch.end();
    await settle(page);
    const after = (await wmState(page)).windows.settings.placement;
    expect(after.x).toBeGreaterThan(before.x + 40);
    expect(after.y).toBeGreaterThan(before.y + 15);
  });

  test("a long press on a window floats it, and another docks it again", async ({ page, browserName }) => {
    const touch = await makeTouch(page, browserName);
    const body = await view(page, "data").locator(".wb-win").boundingBox();
    const [x, y] = [body.x + body.width / 2, body.y + body.height - 8]; // empty space inside the window, not a control
    const press = async () => {
      await touch.start([[x, y]]);
      await page.waitForTimeout(800);
      await touch.end();
    };
    await press();
    await expect.poll(async () => (await wmState(page)).windows.data.mode).toBe("floating");
    const floating = await view(page, "data").locator(".wb-win").boundingBox();
    const [fx, fy] = [floating.x + floating.width / 2, floating.y + floating.height - 8];
    await touch.start([[fx, fy]]);
    await page.waitForTimeout(800);
    await touch.end();
    await expect.poll(async () => (await wmState(page)).windows.data.mode).not.toBe("floating");
  });
});
