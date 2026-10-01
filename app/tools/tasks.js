import { actionOf, idOf, reconcile, setAttr, shadowOf } from "../dom.js";
import { dueText } from "../format.js";

export async function mountTasks(host, { store }) {
  const root = await shadowOf(host);
  const form = root.querySelector("form");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const label = String(data.get("label") ?? "").trim();
    if (!label) return;
    store.addTask({ label, due: String(data.get("due") ?? "") });
    form.reset();
  });
  root.addEventListener("click", (event) => {
    if (actionOf(event)?.dataset.action === "submit") form.requestSubmit();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.localName === "kit--field") form.requestSubmit();
  });
  host.addEventListener("click", (event) => {
    const action = actionOf(event)?.dataset.action;
    if (action === "toggle") store.toggleTask(idOf(event));
    if (action === "delete") store.removeTask(idOf(event));
  });

  const render = ({ tasks }) => {
    setAttr(host, "open", tasks.filter((t) => !t.done).length);
    setAttr(host, "done", tasks.filter((t) => t.done).length);
    reconcile(host, {
      items: tasks, tag: "wb--task-item", slot: "items",
      apply(el, task) {
        const due = dueText(task.due);
        setAttr(el, "label", task.label);
        setAttr(el, "due", due.text);
        setAttr(el, "pressed", String(task.done));
        setAttr(el, "overdue", due.overdue && !task.done);
      },
    });
  };
  render(store.get());
  return store.subscribe(render);
}
