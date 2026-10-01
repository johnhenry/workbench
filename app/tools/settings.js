import { actionOf, setAttr, shadowOf } from "../dom.js";

export const applyTheme = (theme) => {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  else delete root.dataset.theme;
};

export async function mountSettings(host, { store, wm }) {
  const root = await shadowOf(host);
  const form = root.querySelector("form");
  const hint = root.querySelector(".hint");

  root.addEventListener("click", (event) => {
    const el = actionOf(event) ?? event.composedPath().find((n) => n instanceof Element && n.dataset?.setting);
    if (el?.dataset.action === "submit") return form.requestSubmit();
    const { setting, value } = el?.dataset ?? {};
    if (setting === "theme") store.setSetting("theme", value);
    if (setting === "direction") wm.dispatch({ type: "config/set", direction: value });
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.localName === "kit--field") form.requestSubmit();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const owner = String(new FormData(form).get("owner") ?? "").trim();
    if (!owner) return;
    store.setSetting("owner", owner);
    hint.textContent = `Saved. Hello, ${owner}.`;
  });

  const field = form.querySelector('[name="owner"]');
  const render = () => {
    const { settings } = store.get();
    const direction = wm.getState().config.direction ?? "ltr";
    for (const btn of root.querySelectorAll("[data-setting]")) {
      const current = btn.dataset.setting === "theme" ? settings.theme : direction;
      setAttr(btn, "pressed", String(btn.dataset.value === current));
    }
    if (field && document.activeElement !== host && !field.value) field.value = settings.owner ?? "";
  };
  render();
  const off = [store.subscribe(render), wm.subscribe(render)];
  return () => off.forEach((fn) => fn());
}
