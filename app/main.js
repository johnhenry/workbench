// The shell. Three libraries, one page:
//   html-modules    defines every UI component (see /components/*.html) from <html-import> in index.html
//   window-algebra  owns the windows: layout, drag/dock, palette, persistence, cross-tab sync
//   mport           generated the import map these bare specifiers resolve through (scripts/build.mjs)
import "@johnhenry/html-modules/browser";
import { createState, createWindowManager } from "@johnhenry/window-algebra";
import { lazySurface } from "@johnhenry/window-algebra/browser";
import { defineWindowAlgebraElement } from "@johnhenry/window-algebra/element";
import { preloadSanitizer, registerSafeFragment } from "@johnhenry/safe-fragment";
import { createStore, read, WM_KEY, write } from "./store.js";
import { TOOLS, mountTool } from "./tools/index.js";
import { applyTheme } from "./tools/settings.js";

// safe-fragment: defines <safe-fragment> (used inside the note cards). Where there is no native Sanitizer API (Safari) it
// falls back to DOMPurify, which it import()s by bare name: the import map mport built maps "dompurify" (added by
// build({ dependencies: true })), and the CSP's trusted-types lists the policy it creates.
registerSafeFragment();
const sanitizerStatus = document.querySelector("#sanitizer");
preloadSanitizer().then(
  (engine) => { sanitizerStatus.dataset.engine = engine; sanitizerStatus.textContent = `Sanitizer: ${engine}`; },
  (error) => { sanitizerStatus.dataset.engine = "unavailable"; sanitizerStatus.textContent = "Sanitizer: unavailable"; reportError(error); },
);

const $ = (selector) => document.querySelector(selector);
const store = createStore();
applyTheme(store.get().settings.theme);

// --- window manager: restore, or seed --------------------------------------------------------
const wm = createWindowManager({
  state: createState({ layout: { type: "master-stack", ratio: 0.55 }, config: { gap: 8, inset: 8 } }),
  history: 100,
});
const seed = () => {
  wm.create({ id: "notes", title: TOOLS.notes.title });
  wm.create({ id: "tasks", title: TOOLS.tasks.title });
  wm.create({ id: "data", title: TOOLS.data.title });
  wm.create({ id: "settings", title: TOOLS.settings.title, mode: "floating", placement: TOOLS.settings.floating });
  wm.focus("notes");
};
const saved = read(WM_KEY);
if (!(saved && wm.load(saved))) seed();
write(WM_KEY, wm.serialize());
wm.subscribe(() => write(WM_KEY, wm.serialize())); // state survives reload

// --- surfaces: one lazy surface per window id, built from the tool of the same id --------------
const surfaces = new Map();
const surfaceFor = (id) => {
  const win = wm.getState().windows[id];
  if (!win) return undefined;
  if (!surfaces.has(id)) {
    // the stage's built-in chrome supplies the title bar, buttons and grips; the surface mounts into its body
    surfaces.set(id, lazySurface((body) => mountTool(id, win.title || id, body, { store, wm })));
  }
  return surfaces.get(id);
};

// --- the stage: <wa-stage> renders, takes pointer, keyboard and touch input ---------------------
// It also owns the window chrome, the command palette (Ctrl/Cmd+Shift+P) and cross-tab sync, and exposes
// them as stage.palette and stage.sync.
defineWindowAlgebraElement();
const stage = $("#stage");
const syncEl = $("#sync");
const showPeers = () => {
  const peers = stage.sync?.peers().length ?? 0;
  syncEl.textContent = `Tabs: ${peers + 1}`;
  syncEl.dataset.peers = String(peers);
};
stage.configure({
  wm,
  surfaceFor,
  chrome: true, // title bar, buttons, grips: window-algebra's, themed by --wa-* tokens
  // injectStyles: false because the CSP forbids <style>; the palette's CSS is in /styles/generated/wa.css.
  palette: { injectStyles: false },
  sync: { channel: "workbench", onSync: showPeers },
  // keyboard: Alt+Shift+Arrows move/resize a floating window, F6 cycles windows. touch: pinch resizes a
  // floating window, and a long press on any window floats or docks it. announce: aria-live narration.
  input: { keyboard: true, touch: { pinch: true, swipe: { tabs: true }, contextMenu: "window/toggle-floating" }, announce: true },
});
setInterval(showPeers, 500); // peers() changes when a tab closes, which fires no onSync

// --- header: open tools, switch layout, palette, title -----------------------------------------
const openTool = (id) => {
  const state = wm.getState();
  if (state.windows[id]) {
    if (state.windows[id].status === "minimized") wm.restore(id);
    wm.focus(id);
  } else {
    const tool = TOOLS[id];
    wm.create({ id, title: tool.title, ...(tool.floating ? { mode: "floating", placement: tool.floating } : {}) });
  }
};
document.querySelector(".actions").addEventListener("click", (event) => {
  const el = event.composedPath().find((n) => n instanceof Element && (n.dataset?.open || n.dataset?.layout || n.id === "palette-open"));
  if (!el) return;
  if (el.dataset.open) openTool(el.dataset.open);
  else if (el.dataset.layout) wm.setLayout({ type: el.dataset.layout, ...(el.dataset.layout === "master-stack" ? { ratio: 0.55 } : {}) });
  else stage.palette.open();
});

const title = $("#app-title");
const status = $("#status");
const render = () => {
  const state = wm.getState();
  const layout = state.workspaces[state.activeWorkspace]?.layout?.type;
  for (const btn of document.querySelectorAll("[data-layout]")) btn.setAttribute("pressed", String(btn.dataset.layout === layout));
  const owner = store.get().settings.owner;
  title.textContent = owner ? `${owner}'s workbench` : "Workbench";
  const count = Object.keys(state.windows).length;
  status.textContent = `${count} window${count === 1 ? "" : "s"} · layout ${layout} · focus ${state.focus.window ?? "none"}`;
  document.documentElement.dataset.direction = state.config.direction ?? "ltr";
};
render();
wm.subscribe(render);
store.subscribe(render);
addEventListener("storage", (event) => { if (event.key === "workbench:data") applyTheme(store.get().settings.theme); });
store.subscribe((data) => applyTheme(data.settings.theme));

// A handle for the end-to-end tests and for poking around in the console.
window.workbench = { wm, store, stage, get palette() { return stage.palette; }, get sync() { return stage.sync; } };
document.documentElement.dataset.ready = "true";
Promise.all([...document.querySelectorAll("html-import")].map((el) => el.ready)).then(
  () => { document.documentElement.dataset.components = "ready"; },
  (error) => { document.documentElement.dataset.components = "error"; reportError(error); },
);
