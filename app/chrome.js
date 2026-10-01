// Window chrome: a title bar that is a window-algebra drag handle, buttons that dispatch commands
// (data-wm-command), and resize grips. This is the shell's markup; everything inside the body is
// an html-modules component.
import { lazySurface } from "@johnhenry/window-algebra/browser";
import { h } from "./dom.js";

const GRIPS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export function windowSurface({ id, title, mount }) {
  return lazySurface((target) => {
    const titleId = `wb-title-${id}`;
    const button = (command, action, label, text) =>
      h("button", { type: "button", class: "wb-btn", "data-wm-command": command, "data-action-name": action, title: label, "aria-label": `${label}: ${title}` }, text);
    const bar = h(
      "div",
      { class: "wb-bar", "data-wm-handle": "move" },
      h("h2", { class: "wb-title", id: titleId, "data-wb-title": "" }, title),
      h("span", { class: "wb-actions" },
        button("window/toggle-floating", "float", "Float window", "◱"),
        button("window/toggle-maximize", "maximize", "Maximize window", "▢"),
        button("window/close", "close", "Close window", "✕")),
    );
    const body = h("div", { class: "wb-body", role: "region", "aria-labelledby": titleId, tabindex: "0" });
    const win = h("div", { class: "wb-win" }, bar, body);
    const grips = GRIPS.map((edge) => h("div", { class: "wb-grip", "data-wm-handle": `resize-${edge}` }));
    target.append(win, ...grips);
    const dispose = mount(body);
    return () => {
      if (typeof dispose === "function") dispose();
      win.remove();
      grips.forEach((g) => g.remove());
    };
  });
}

/** Keep titles and the toggle buttons' labels in step with state. */
export function syncChrome(wm, root) {
  const run = (state = wm.getState()) => {
    for (const view of root.querySelectorAll("wm-view[data-view]")) {
      const win = state.windows[view.getAttribute("data-view")];
      if (!win) continue;
      const name = win.title || win.id;
      const title = view.querySelector("[data-wb-title]");
      if (title && title.textContent !== name) title.textContent = name;
      const set = (action, label, pressed) => {
        const btn = view.querySelector(`:scope > .wb-win [data-action-name="${action}"]`);
        if (!btn) return;
        btn.setAttribute("aria-label", `${label}: ${name}`);
        btn.title = label;
        btn.setAttribute("aria-pressed", String(pressed));
      };
      set("float", win.mode === "floating" ? "Dock window" : "Float window", win.mode === "floating");
      set("maximize", win.status === "maximized" ? "Restore window" : "Maximize window", win.status === "maximized");
    }
  };
  run();
  return { run, unsubscribe: wm.subscribe((state) => requestAnimationFrame(() => run(state))) };
}
