import { actionOf, idOf, reconcile, setAttr, shadowOf } from "../dom.js";
import { ago } from "../format.js";
import { removalsOf, summarize } from "../sanitize-report.js";

// A note's body is untrusted rich text: pasted HTML. Markup goes through safe-fragment's article-v1 profile; text with
// no markup in it goes through plain-text-v1 (textContent, no parser), which keeps its line breaks.
const looksLikeMarkup = (text) => /<[a-z!/]/i.test(text);

// Hand a note's body to the <safe-fragment> inside its card, once per change, and put the report in the card.
async function renderBody(card, note) {
  const root = await shadowOf(card);
  const fragment = root.querySelector("safe-fragment");
  const profile = looksLikeMarkup(note.body) ? "article-v1" : "plain-text-v1";
  if (!card.__listening) {
    card.__listening = true;
    fragment.addEventListener("safe-fragment:render", (event) => {
      const { report } = event.detail;
      const removed = removalsOf(report);
      setAttr(card, "report", removed.length ? summarize(removed, { profile: report.profile, engine: report.engine }) : "");
    });
    fragment.addEventListener("safe-fragment:reject", (event) => setAttr(card, "report", `Not rendered: ${event.detail.code}`));
  }
  if (card.__body === note.body) return;
  card.__body = note.body;
  if (fragment.profile !== profile) fragment.profile = profile;
  fragment.html = note.body; // a property: the string never passes through an attribute or an HTML sink of ours
}

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
        renderBody(el, note).catch((error) => reportError(error));
        setAttr(el, "updated", `Updated ${ago(note.updated)}`);
      },
    });
  };
  render(store.get());
  return store.subscribe(render);
}
