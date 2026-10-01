import { actionOf, idOf, reconcile, setAttr, shadowOf } from "../dom.js";
import { ago } from "../format.js";

export async function mountNotes(host, { store }) {
  const root = await shadowOf(host);
  const form = root.querySelector("form");

  const submit = () => form.requestSubmit();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form); // the form-associated <kit--field>/<kit--area> are in here
    const title = String(data.get("title") ?? "").trim();
    if (!title) return;
    store.addNote({ title, body: String(data.get("body") ?? "").trim() });
    form.reset();
  });
  root.addEventListener("click", (event) => {
    if (actionOf(event)?.dataset.action === "submit") submit();
  });
  // Enter in a single-line field submits (implicit submission does not cross the field's shadow root).
  root.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.localName === "kit--field") submit();
  });
  host.addEventListener("click", (event) => {
    if (actionOf(event)?.dataset.action === "delete") store.removeNote(idOf(event));
  });

  const render = ({ notes }) => {
    setAttr(host, "count", notes.length);
    reconcile(host, {
      items: notes, tag: "wb--note-card", slot: "items",
      apply(el, note) {
        setAttr(el, "heading", note.title);
        setAttr(el, "body", note.body);
        setAttr(el, "updated", `Updated ${ago(note.updated)}`);
      },
    });
  };
  render(store.get());
  return store.subscribe(render);
}
