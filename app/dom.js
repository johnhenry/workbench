// Small DOM helpers. No innerHTML anywhere: the page enforces Trusted Types.

export const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) if (value !== undefined && value !== false) el.setAttribute(name, value === true ? "" : String(value));
  el.append(...children.filter((c) => c !== undefined && c !== null));
  return el;
};

/** The shadow root of an html-modules component, once its module has loaded and registered the tag. */
export async function shadowOf(host) {
  await customElements.whenDefined(host.localName);
  for (let i = 0; !host.shadowRoot && i < 120; i++) await new Promise((r) => requestAnimationFrame(r));
  if (!host.shadowRoot) throw new Error(`<${host.localName}> never got a shadow root`);
  return host.shadowRoot;
}

/** The nearest element on the event's composed path (through shadow roots) that carries `data-action`. */
export const actionOf = (event) => event.composedPath().find((n) => n instanceof Element && n.dataset?.action);
export const idOf = (event) => event.composedPath().find((n) => n instanceof Element && n.dataset?.id)?.dataset.id;

/** Keep `host`'s `<tag slot=...>` children in step with `items`, keyed by item.id, reusing elements. */
export function reconcile(host, { items, tag, slot, apply }) {
  const existing = new Map([...host.children].filter((c) => c.localName === tag && c.getAttribute("slot") === slot).map((c) => [c.dataset.id, c]));
  let anchor = null;
  for (const item of items) {
    const el = existing.get(item.id) ?? h(tag, { slot, "data-id": item.id });
    existing.delete(item.id);
    apply(el, item);
    // keep document order equal to item order without re-inserting nodes that are already in place
    const expected = anchor ? anchor.nextElementSibling : host.firstElementChild;
    if (el !== expected) host.insertBefore(el, expected);
    anchor = el;
  }
  for (const stale of existing.values()) stale.remove();
}

/** Set an attribute only when it changed (keeps html-modules' bound nodes from re-patching). */
export const setAttr = (el, name, value) => {
  if (value === false || value === null || value === undefined) el.removeAttribute(name);
  else if (el.getAttribute(name) !== String(value === true ? "" : value)) el.setAttribute(name, value === true ? "" : String(value));
};
