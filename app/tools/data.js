import { reconcile, setAttr, shadowOf } from "../dom.js";
import { clock } from "../format.js";

const SKIP = new Set(["render"]);

export async function mountData(host, { wm }) {
  await shadowOf(host);
  const events = [];

  // The import map this page is running on: what mport generated, as data.
  const map = JSON.parse(document.querySelector('script[type="importmap"]')?.textContent ?? "{}");
  const integrity = map.integrity ?? {};
  const imports = Object.entries(map.imports ?? {}).map(([key, url]) => ({
    id: key, url, cdn: /^https?:/.test(url), hashed: url in integrity,
  }));
  reconcile(host, {
    items: imports, tag: "wb--data-row", slot: "imports",
    apply(el, entry) {
      setAttr(el, "name", entry.id);
      setAttr(el, "detail", entry.cdn ? new URL(entry.url).host : entry.url.split("/").slice(-2).join("/"));
      setAttr(el, "tone", entry.cdn ? (entry.hashed ? "cdn+sri" : "cdn") : "local");
    },
  });

  const renderStats = (state) => {
    const windows = Object.values(state.windows);
    const layout = state.workspaces[state.activeWorkspace]?.layout;
    setAttr(host, "windows", windows.length);
    setAttr(host, "tiled", windows.filter((w) => w.mode !== "floating").length);
    setAttr(host, "floating", windows.filter((w) => w.mode === "floating").length);
    setAttr(host, "layout", layout?.type ?? "?");
  };
  const renderEvents = () => {
    reconcile(host, {
      items: events, tag: "wb--data-row", slot: "events",
      apply(el, e) {
        setAttr(el, "name", e.type);
        setAttr(el, "detail", `${e.window ?? ""} ${clock(e.at)}`.trim());
        setAttr(el, "tone", "event");
      },
    });
  };
  renderStats(wm.getState());

  let seq = 0;
  return wm.subscribe((state, evs = []) => {
    renderStats(state);
    const fresh = evs.filter((e) => !SKIP.has(e.type));
    for (const e of fresh) events.unshift({ id: `${++seq}`, type: e.type, window: e.id, at: Date.now() });
    events.length = Math.min(events.length, 8);
    if (fresh.length) renderEvents();
  });
}
