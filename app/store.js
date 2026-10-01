// App data (notes, tasks, settings) in localStorage, shared between tabs through the `storage` event.
// The window layout is persisted separately, by window-algebra (wm.serialize()/wm.load()).
export const DATA_KEY = "workbench:data";
export const WM_KEY = "workbench:wm";

const EMPTY = () => ({ notes: [], tasks: [], settings: { theme: "system", owner: "" } });

export const read = (key) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
export const write = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* private mode or quota: the app still works for this session */ }
};

export function createStore() {
  let data = EMPTY();
  const listeners = new Set();
  try {
    const saved = JSON.parse(read(DATA_KEY) ?? "null");
    if (saved && typeof saved === "object") data = { ...EMPTY(), ...saved, settings: { ...EMPTY().settings, ...saved.settings } };
  } catch { /* corrupt JSON: start empty */ }

  const emit = () => listeners.forEach((fn) => fn(data));
  const save = () => {
    write(DATA_KEY, JSON.stringify(data));
    emit();
  };
  addEventListener("storage", (event) => {
    if (event.key !== DATA_KEY || event.newValue == null) return;
    try {
      const next = JSON.parse(event.newValue);
      data = { ...EMPTY(), ...next, settings: { ...EMPTY().settings, ...next.settings } };
      emit();
    } catch { /* ignore */ }
  });

  const id = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return {
    get: () => data,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    addNote({ title, body }) { data.notes = [{ id: id(), title, body, updated: Date.now() }, ...data.notes]; save(); },
    removeNote(noteId) { data.notes = data.notes.filter((n) => n.id !== noteId); save(); },
    addTask({ label, due }) { data.tasks = [...data.tasks, { id: id(), label, due: due || null, done: false }]; save(); },
    toggleTask(taskId) { data.tasks = data.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)); save(); },
    removeTask(taskId) { data.tasks = data.tasks.filter((t) => t.id !== taskId); save(); },
    setSetting(name, value) { data.settings = { ...data.settings, [name]: value }; save(); },
  };
}
