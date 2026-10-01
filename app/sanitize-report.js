// What a sanitizer removed, as one line a person can read. Both integrations feed it:
//   <safe-fragment>              a SanitizationReport  { removedElements, removedAttributes, rewrittenUrls, engine }
//   html-modules sanitize hook   { removed: [{ what, tag, attribute?, reason }] }  (the adapter's own report)

// DOMPurify's own log lists the wrappers it parses into (body, remove) as removed elements of every input,
// benign ones included (safe-fragment#9, filtered by the html-modules adapter too). They are never in the input.
const ENGINE_ARTEFACTS = new Set(["body", "head", "html", "remove"]);
const real = (note) => !(ENGINE_ARTEFACTS.has(note.tag) && String(note.reason).startsWith("removed-by-engine:dompurify"));

const label = (note) => (note.attribute ? `${note.tag}[${note.attribute}]` : `<${note.tag}>`);

/** Normalise a safe-fragment SanitizationReport to a list of { what, tag, attribute?, reason }. */
export function removalsOf(report) {
  return [
    ...(report.removedElements ?? []).filter(real).map((n) => ({ ...n, what: "element" })),
    ...(report.removedAttributes ?? []).filter(real).map((n) => ({ ...n, what: "attribute" })),
    ...(report.rewrittenUrls ?? []).filter(real).map((n) => ({ ...n, what: "url" })),
  ];
}

/** "Sanitized (article-v1, native): removed 3: <script>, img[onerror], a[href]" or "... nothing removed". */
export function summarize(removed, { profile, engine } = {}) {
  const head = `Sanitized${profile ? ` (${profile}${engine ? `, ${engine}` : ""})` : ""}`;
  // The native Sanitizer API removes script, frames, on* handlers and javascript: URLs itself and cannot say so: its report
  // lists only what the profile removed on top (safe-fragment ADR 0007). Say that, rather than "removed 1" for a note that lost five.
  const caveat = engine === "native" ? " (the native engine's own removals are not listed)" : "";
  if (!removed.length) return `${head}: nothing listed${caveat}`;
  const labels = [...new Set(removed.map(label))];
  const shown = labels.slice(0, 6).join(", ");
  return `${head}: removed ${removed.length}: ${shown}${labels.length > 6 ? `, +${labels.length - 6} more` : ""}${caveat}`;
}
