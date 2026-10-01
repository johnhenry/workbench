// Build step: ask mport for the page's import map, then render index.html.
//
//   npm run build            resolve through the lockfile (network only for files the lock doesn't know)
//   npm run build:offline    same, but CDN bytes come from test/fixtures/cdn (hermetic CI)
//   node scripts/build.mjs --relock   ignore mport.lock.json and resolve from scratch
//
// Outputs (all generated; only mport.lock.json is committed):
//   index.html               from app/index.template.html, with a CSP, the import map and modulepreloads
//   importmap.json           the import map on its own, for inspection
//   styles/generated/wa.css  window-algebra's theme + rules + palette CSS as a file, so the CSP needs no
//                            'unsafe-inline' for <style> (the library injects them as <style> by default)
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  createRegistry, createRouter, custom, esmSh, local,
  renderImportMapCsp, renderModulePreload,
} from "@johnhenry/mport";
import { installedRegistry } from "@johnhenry/mport/node";
import { BASE_CSS } from "@johnhenry/window-algebra/css";
import { PALETTE_CSS } from "@johnhenry/window-algebra/browser";
import { offlineFetch } from "./offline-fetch.mjs";

const root = new URL("../", import.meta.url);
const args = new Set(process.argv.slice(2));
const OFFLINE = args.has("--offline");
const RELOCK = args.has("--relock");
const LOCK = new URL("mport.lock.json", root);

// What the page imports. Specifiers are written as the app writes them; ranges are pinned by the lockfile.
export const SPECIFIERS = [
  "@johnhenry/window-algebra",
  "@johnhenry/window-algebra/browser",
  "@johnhenry/window-algebra/element",
  "@johnhenry/html-modules/browser",
  "@johnhenry/html-modules/runtime",
  "@workbench/ui/",
  "dayjs@^1.11",
  "dayjs@^1.11/plugin/relativeTime",
];

const fetch = OFFLINE ? await offlineFetch(new URL("test/fixtures/cdn/", root)) : globalThis.fetch;
const lock = !RELOCK && existsSync(LOCK) ? JSON.parse(await readFile(LOCK, "utf8")) : undefined;

const router = createRouter(
  {
    // The three libraries are installed from git, so they are not on npm: serve them from our own
    // node_modules (local()); installedRegistry() answers version/entry lookups from the installed package.json.
    "@johnhenry/*": local({ base: "/node_modules/" }),
    // The app's own HTML modules, as a prefix mapping: <html-import src="@workbench/ui/kit.html">.
    "@workbench/*": custom("/components/{path}", { name: "app", build: "app" }),
    // A genuine third-party package, from a public CDN.
    "*": esmSh(),
  },
  {
    lock,
    probe: "none", // a build-time mapping: no HEAD request per candidate
    fetch,
    registry: installedRegistry({ root: new URL("node_modules/", root), fallback: createRegistry({ fetch }) }),
  },
);

const { importMap, lock: newLock, graph } = await router.build(SPECIFIERS, { graph: true });

// --- CSP -----------------------------------------------------------------------------------------
// The import map is inline, so script-src needs its hash (a static site has no per-request nonce).
// renderImportMapCsp() returns the tag and the hash of exactly the text inside it.
const { html: mapHtml, hash: mapHash } = await renderImportMapCsp(importMap);
const cdnOrigins = [...new Set(Object.values(importMap.imports).filter((u) => /^https?:/.test(u)).map((u) => new URL(u).origin))];

const csp = [
  "default-src 'none'",
  `script-src 'self' ${mapHash} ${cdnOrigins.join(" ")}`.trim(),
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
  // Every HTML sink goes through a Trusted Types policy; html-modules creates the one named "html-modules".
  "require-trusted-types-for 'script'",
  "trusted-types html-modules",
].join("; ");

// --- index.html ----------------------------------------------------------------------------------
// The import map comes BEFORE the modulepreload links: an engine that has started a module load or
// preload refuses a later import map (README, finding M2).
const template = await readFile(new URL("app/index.template.html", root), "utf8");
const html = template
  .replace("<!--CSP-->", `<meta http-equiv="Content-Security-Policy" content="${csp}">`)
  .replace("<!--IMPORTMAP-->", mapHtml)
  .replace("<!--PRELOAD-->", renderModulePreload(importMap));
if (/<!--(CSP|IMPORTMAP|PRELOAD)-->/.test(html)) throw new Error("build: unreplaced placeholder in the template");

await mkdir(new URL("styles/generated/", root), { recursive: true });
await writeFile(new URL("index.html", root), html);
await writeFile(new URL("importmap.json", root), `${JSON.stringify(importMap, null, 2)}\n`);
await writeFile(new URL("styles/generated/wa.css", root), `${BASE_CSS}\n${PALETTE_CSS}\n`);
await writeFile(LOCK, `${JSON.stringify(newLock, null, 2)}\n`);

const skipped = graph.skipped.filter((s) => s.reason.startsWith("not an absolute"));
console.log(
  `workbench: wrote index.html (${Object.keys(importMap.imports).length} imports, ` +
    `${Object.keys(importMap.integrity ?? {}).length} files with integrity, ${skipped.length} local modules without), ` +
    `importmap.json, styles/generated/wa.css and mport.lock.json${OFFLINE ? " [offline]" : ""}`,
);
