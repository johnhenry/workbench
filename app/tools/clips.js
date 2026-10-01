// The "less trusted module" half of the safe-fragment integration.
//
// components/untrusted/clip.html stands for a module somebody else wrote. It is loaded through html-modules' `sanitize`
// hook, with the adapter @johnhenry/html-modules/safe-fragment: every component template in it goes through
// safe-fragment's sanitizeToFragment() under a profile before the component is defined, and the adapter reports what the
// profile removed as `html-modules:sanitize` events, which this tool lists.
//
// Both libraries come in by bare specifier, through the import map mport built (scripts/build.mjs).
import * as safeFragment from "@johnhenry/safe-fragment";
import { safeFragmentSanitizer } from "@johnhenry/html-modules/safe-fragment";
import { h, reconcile, setAttr, shadowOf } from "../dom.js";

const MODULE = "@workbench/ui/untrusted/clip.html";

// One function for the page: html-modules caches a module per sanitizer function.
// article-v1 plus the `clip--*` custom elements; registered with safe-fragment on first use.
const sanitize = safeFragmentSanitizer({ safeFragment, profile: { base: "article-v1", namespaces: ["clip"] } });

const removals = []; // what the sanitizer took out, as the adapter reported it
const listeners = new Set();
document.addEventListener("html-modules:sanitize", (event) => {
  const { details } = event.detail ?? {};
  for (const note of details?.removed ?? []) removals.push({ ...note, profile: details.profile, engine: details.engine, component: event.detail.name });
  listeners.forEach((fn) => fn());
});

let loading;
/** Load the less-trusted module once, sanitized. Resolves when its components are defined. */
export function loadClipModule() {
  return (loading ??= (async () => {
    const el = document.createElement("html-import");
    el.setAttribute("src", MODULE);
    el.setAttribute("as", "clip");
    el.sanitize = sanitize; // a function cannot be an attribute: set it in script, before the import starts
    document.body.append(el);
    await el.ready;
    await customElements.whenDefined("clip--card");
  })());
}

export async function mountClips(host) {
  await shadowOf(host);
  await loadClipModule();
  host.append(h("clip--card", { slot: "card", heading: "A clip from elsewhere" }));
  const render = () => {
    setAttr(host, "removed", removals.length);
    reconcile(host, {
      items: removals.map((note, i) => ({ id: String(i), note })),
      tag: "wb--removal", slot: "removed",
      apply(el, { note }) {
        setAttr(el, "name", note.attribute ? `${note.tag}[${note.attribute}]` : `<${note.tag}>`);
        setAttr(el, "detail", `${note.what}: ${note.reason}`);
      },
    });
  };
  render();
  listeners.add(render);
  return () => listeners.delete(render);
}
