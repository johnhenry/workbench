import { h } from "../dom.js";
import { mountNotes } from "./notes.js";
import { mountTasks } from "./tasks.js";
import { mountData } from "./data.js";
import { mountSettings } from "./settings.js";
import { mountClips } from "./clips.js";

// id -> { title, tag, mount }. A tool is an html-modules component (tag) plus the glue that feeds it data.
export const TOOLS = {
  notes: { title: "Notes", tag: "wb--notes-tool", mount: mountNotes },
  tasks: { title: "Tasks", tag: "wb--tasks-tool", mount: mountTasks },
  data: { title: "Data", tag: "wb--data-tool", mount: mountData },
  clips: { title: "Clips", tag: "wb--clips-tool", mount: mountClips },
  settings: { title: "Settings", tag: "wb--settings-tool", mount: mountSettings, floating: { x: 70, y: 70, width: 380, height: 420 } },
};

/** Mount a tool's component into `body`; returns a cleanup. Unknown ids get the generic scratch component. */
export function mountTool(id, title, body, ctx) {
  const tool = TOOLS[id];
  const el = h(tool?.tag ?? "wb--scratch", tool ? {} : { heading: title });
  body.append(el);
  let off;
  let disposed = false;
  tool?.mount(el, ctx).then((fn) => { if (disposed) fn?.(); else off = fn; }, (error) => reportError(error));
  return () => { disposed = true; off?.(); el.remove(); };
}
