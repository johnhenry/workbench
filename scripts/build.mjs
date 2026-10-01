// Build step: ask mport for the page's import map, then render index.html.
//
//   npm run build            resolve through the lockfile (network only for files the lock doesn't know)
//   npm run build:offline    same, but CDN bytes come from test/fixtures/cdn (hermetic CI)
//   node scripts/build.mjs --relock   ignore mport.lock.json and resolve from scratch
//   node scripts/build.mjs --base /workbench/ --out dist
//                            a deployable site: everything under dist/, served at a subpath. The libraries are copied
//                            to dist/vendor/ (a static host serves no node_modules) and the import map, the CSP and the
//                            component prefix all carry the base. mport.lock.json is read, not rewritten.
//
// Outputs (all generated; only mport.lock.json is committed):
//   index.html               from app/index.template.html, with a CSP, the import map and modulepreloads
//   importmap.json           the import map on its own, for inspection
//   styles/generated/wa.css  window-algebra's theme + rules + palette CSS as a file, so the CSP needs no
//                            'unsafe-inline' for <style> (the library injects them as <style> by default)
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  createRegistry, createRouter, custom, esmSh, local,
  renderImportMapCsp, renderModulePreload,
} from "@johnhenry/mport";
import { installedRegistry } from "@johnhenry/mport/node";
import { BASE_CSS } from "@johnhenry/window-algebra/css";
import { PALETTE_CSS } from "@johnhenry/window-algebra/browser";
import { offlineFetch } from "./offline-fetch.mjs";

const root = new URL("../", import.meta.url);
const argv = process.argv.slice(2);
const args = new Set(argv);
const OFFLINE = args.has("--offline");
const RELOCK = args.has("--relock");
const option = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
// --base: the URL path the site is served under ("/" or "/workbench/"). --out: write a deployable copy there.
const BASE = (option("--base") ?? "/").replace(/^\/?/, "/").replace(/\/?$/, "/");
const OUT = option("--out") ? new URL(`${option("--out").replace(/\/?$/, "/")}`, `file://${process.cwd()}/`) : undefined;
// Where the page finds the libraries: the installed node_modules in development, a copy in the artifact when deployed.
const LIB_BASE = OUT ? `${BASE}vendor/` : `${BASE}node_modules/`;
const LOCK = new URL("mport.lock.json", root);

// What the page imports. Specifiers are written as the app writes them; ranges are pinned by the lockfile.
export const SPECIFIERS = [
  "@johnhenry/window-algebra",
  "@johnhenry/window-algebra/browser",
  "@johnhenry/window-algebra/element",
  "@johnhenry/html-modules/browser",
  "@johnhenry/html-modules/runtime",
  "@johnhenry/html-modules/safe-fragment",
  // safe-fragment's DOMPurify fallback does import("dompurify"): a bare specifier the map must cover. It is not
  // listed here on purpose: build({ dependencies: true }) adds it from safe-fragment's own `dependencies`.
  "@johnhenry/safe-fragment",
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
    "@johnhenry/*": local({ base: LIB_BASE }),
    // safe-fragment's own dependency, found by build({ dependencies: true }) and routed by the same router: without
    // this line "*" (esm.sh) would claim it. Served from node_modules too, so the page's DOMPurify is the pinned one.
    dompurify: local({ base: LIB_BASE }),
    // The app's own HTML modules, as a prefix mapping: <html-import src="@workbench/ui/kit.html">.
    "@workbench/*": custom(`${BASE}components/{path}`, { name: "app", build: "app" }),
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

const { importMap, lock: newLock, graph, dependencies } = await router.build(SPECIFIERS, { graph: true, dependencies: true });

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
  "trusted-types html-modules dompurify",
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

const wrote = [];
const dest = OUT ?? root;
if (OUT) { await rm(OUT, { recursive: true, force: true }); await mkdir(OUT, { recursive: true }); }
const put = async (rel, data) => {
  const target = new URL(rel, dest);
  await mkdir(new URL("./", target), { recursive: true });
  await writeFile(target, data);
};
await put("index.html", html);
await put("importmap.json", `${JSON.stringify(importMap, null, 2)}\n`);
await put("styles/generated/wa.css", `${BASE_CSS}\n${PALETTE_CSS}\n`);

if (!OUT) {
  await writeFile(LOCK, `${JSON.stringify(newLock, null, 2)}\n`);
} else {
  // The deployable site: the app, and the packages the import map points at. A map entry is
  // LIB_BASE + <package name> + "/..."; each such package is copied whole (minus source maps and nested node_modules).
  for (const dir of ["app", "components"]) await cp(new URL(`${dir}/`, root), new URL(`${dir}/`, OUT), { recursive: true });
  await cp(new URL("styles/app.css", root), new URL("styles/app.css", OUT));
  await cp(new URL("favicon.svg", root), new URL("favicon.svg", OUT));
  await put(".nojekyll", ""); // no Jekyll pass: files and directories starting with "_" or "." are served as they are
  const vendored = new Set();
  for (const url of Object.values(importMap.imports)) {
    if (!url.startsWith(LIB_BASE)) continue;
    const parts = url.slice(LIB_BASE.length).split("/");
    vendored.add(parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]);
  }
  for (const pkg of vendored) {
    await cp(new URL(`node_modules/${pkg}/`, root), new URL(`vendor/${pkg}/`, OUT), {
      recursive: true, filter: (src) => !src.endsWith(".map") && !/\/node_modules\/.*\/node_modules(\/|$)/.test(src),
    });
  }
  wrote.push(`${vendored.size} vendored packages`);
}

// build({ dependencies: true }) reports what it could not add instead of throwing: surface it.
// (esm.sh and the app prefix rewrite their own imports: skipped by design, not worth a line)
for (const note of [...dependencies.skipped.filter((n) => !/rewrites its own imports/.test(n.reason)), ...dependencies.truncated]) console.warn(`workbench: dependency not added: ${JSON.stringify(note)}`);
console.log(`workbench: dependencies added by mport: ${dependencies.added.map((d) => `${d.specifier} (from ${d.from})`).join(", ") || "none"}`);

const skipped = graph.skipped.filter((s) => s.reason.startsWith("not an absolute"));
console.log(
  `workbench: wrote index.html (${Object.keys(importMap.imports).length} imports, ` +
    `${Object.keys(importMap.integrity ?? {}).length} files with integrity, ${skipped.length} local modules without), ` +
    `importmap.json, styles/generated/wa.css${OUT ? ` and a deployable copy in ${fileURLToPath(OUT)} (base ${BASE}; ${wrote.join(", ")})` : " and mport.lock.json"}${OFFLINE ? " [offline]" : ""}`,
);
