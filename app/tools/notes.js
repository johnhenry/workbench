import { actionOf, idOf, reconcile, setAttr, shadowOf } from "../dom.js";
import { ago } from "../format.js";

export async function mountNotes(host, { store }) {
  const root = await shadowOf(host);
  const form = root.querySelector("form");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form); // the form-associated <kit--field>/<kit--area> are in here
    const title = String(data.get("title") ?? "").trim();
    if (!title) return;
    store.addNote({ title, body: String(data.get("body") ?? "").trim() });
    form.reset();
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
