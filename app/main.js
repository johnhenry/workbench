// The shell. Three libraries, one page:
//   html-modules    defines every UI component (see /components/*.html) from <html-import> in index.html
//   window-algebra  owns the windows: layout, drag/dock, palette, persistence, cross-tab sync
//   mport           generated the import map these bare specifiers resolve through (scripts/build.mjs)
import "@johnhenry/html-modules/browser";
import { createState, createWindowManager } from "@johnhenry/window-algebra";
import { attachSync, createPalette } from "@johnhenry/window-algebra/browser";
import { defineWindowAlgebraElement } from "@johnhenry/window-algebra/element";
import { syncChrome, windowSurface } from "./chrome.js";
import { createStore, read, WM_KEY, write } from "./store.js";
import { TOOLS, mountTool } from "./tools/index.js";
import { applyTheme } from "./tools/settings.js";

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
    surfaces.set(id, windowSurface({ id, title: win.title || id, mount: (body) => mountTool(id, win.title || id, body, { store, wm }) }));
  }
  return surfaces.get(id);
};

// --- the stage: <wa-stage> renders, takes pointer, keyboard and touch input ---------------------
defineWindowAlgebraElement();
const stage = $("#stage");
stage.configure({
  wm,
  surfaceFor,
  input: { keyboard: true, touch: true, announce: true },
});
syncChrome(wm, stage);

// --- command palette (Ctrl/Cmd+Shift+P) ----------------------------------------------------------
// injectStyles: false because the CSP forbids <style>; the palette's CSS is in /styles/generated/wa.css.
const palette = createPalette({ wm, injectStyles: false });

// --- cross-tab sync ----------------------------------------------------------------------------
const syncEl = $("#sync");
const sync = attachSync({
  wm,
  channel: "workbench",
  onSync: () => {
    const peers = sync.peers().length;
    syncEl.textContent = `Tabs: ${peers + 1}`;
    syncEl.dataset.peers = String(peers);
  },
});
setInterval(() => {
  const peers = sync.peers().length;
  syncEl.textContent = `Tabs: ${peers + 1}`;
  syncEl.dataset.peers = String(peers);
}, 500);

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
  else palette.open();
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
window.workbench = { wm, store, stage, palette, sync };
document.documentElement.dataset.ready = "true";
Promise.all([...document.querySelectorAll("html-import")].map((el) => el.ready)).then(
  () => { document.documentElement.dataset.components = "ready"; },
  (error) => { document.documentElement.dataset.components = "error"; reportError(error); },
);
