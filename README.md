# workbench

[![CI](https://github.com/johnhenry/workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/johnhenry/workbench/actions/workflows/ci.yml)

A small, real app that exists to test one claim: that three sibling libraries, which depend on nothing
from each other, **meet at the import map**.

| Library | Does | Docs |
| --- | --- | --- |
| [`@johnhenry/mport`](https://github.com/johnhenry/mport) | routes imports across CDNs and compiles them to an import map and a lockfile | [opensource.johnhenry.me/mport](https://opensource.johnhenry.me/mport/) |
| [`@johnhenry/html-modules`](https://github.com/johnhenry/html-modules) | declarative Web Components in ordinary `.html` files | [opensource.johnhenry.me/html-modules](https://opensource.johnhenry.me/html-modules/) |
| [`@johnhenry/window-algebra`](https://github.com/johnhenry/window-algebra) | a functional window manager: layouts, drag and dock, palette, sync | [opensource.johnhenry.me/window-algebra](https://opensource.johnhenry.me/window-algebra/) |

The claim holds: the import map is a real seam, and the page needs no bundler. The friction was in the details;
[what was found](#findings) is listed below, and the bugs are fixed in the libraries.

## What it is

A workbench with four tool windows (notes, tasks, a data view, settings) in a tiling window manager.

- **Shell** (window-algebra): `<wa-stage>` with two layouts (master-stack and grid) plus floating windows, drag to
  move, dock and reorder, the command palette (`Ctrl/Cmd+Shift+P`), keyboard moving (`Alt+Shift+Arrows`), touch
  (drag, pinch, long-press to float or dock), light/dark theming through `--wa-*` tokens, right-to-left,
  `serialize()`/`load()` to `localStorage`, and cross-tab sync.
- **Components** (html-modules): everything inside a window is an HTML module in [`components/`](components):
  data-bound templates (`{{attr}}` and `props`), form-associated fields used in three real forms, a stylesheet
  export, and a shared `kit.html` that every tool module imports (modules importing modules).
- **Import map** (mport): `npm run build` asks mport for the page's import map and lockfile and writes `index.html`
  with `renderImportMap()` and `renderModulePreload()`.
- **A real third-party package**: `dayjs` (and its `relativeTime` plugin) from esm.sh, formatting due dates and
  "updated" times, pinned by `mport.lock.json` with `graph` integrity.
- **Strict CSP**: a meta CSP with `require-trusted-types-for 'script'`, `trusted-types html-modules`, no
  `'unsafe-inline'` and no `'unsafe-eval'`.

## How the three fit together

```
                         build time (Node)                                  run time (browser)

  mport.lock.json ─┐
  scripts/build.mjs│  createRouter({                                   ┌──────────────────────────────┐
                   ├─►   "@johnhenry/*":  local()   ── node_modules ───┤ <script type="importmap">    │
  node_modules/    │     "@workbench/*":  custom("/components/{path}") │  "@johnhenry/window-algebra" │
   @johnhenry/*    │     "*":             esmSh()    ── esm.sh ────────┤  "@johnhenry/html-modules/…" │
                   │   }).build(specs, { graph: true })                │  "@workbench/ui/"  (prefix)  │
                   │         │                                         │  "dayjs", "dayjs/plugin/…"   │
                   │         ▼                                         │  "integrity": { esm.sh files }│
                   │   renderImportMap() + renderModulePreload()       └───────┬───────────┬──────────┘
                   │   + CSP (hash of the map, hashes of component CSS)        │           │
                   └──►  index.html                                            │           │
                                                                               ▼           ▼
        <html-import src="@workbench/ui/notes.html">  ──────────────►  html-modules   window-algebra
          resolves through the import map to /components/notes.html     (components)   (windows)
                                                                               │           │
                  kit.html  ◄── imported by every tool module                  └─────┬─────┘
                                                                                     ▼
                                                    htmlSurface-style surfaces: a window's body is <wb--notes-tool>…
```

- **mport → html-modules.** An `<html-import src>` that is not a URL is resolved with `import.meta.resolve`, which
  applies the page's import map. mport emits `"@workbench/ui/": "/components/"`, so `src="@workbench/ui/notes.html"`
  loads `/components/notes.html`, and modules import each other the same way.
- **mport → window-algebra.** The shell imports `@johnhenry/window-algebra`, `/browser` and `/element` by bare name;
  mport maps each to the installed file (`local()`). The two libraries never import each other.
- **html-modules → window-algebra.** A window is a surface that mounts an element. An html-modules component is a
  plain custom element, so a window's body is just `document.createElement("wb--notes-tool")`.
- **mport → the page.** dayjs is not installed. The map points it at esm.sh, with an `integrity` hash for every
  file of its import graph, so a changed CDN file is refused by the engine.

## Run it

Node 24 or newer (the libraries ask for 26; 24 works with a warning). The libraries are not on npm, so they are
installed from git, pinned to commit shas in `package.json`.

```sh
npm install          # git dependencies, Playwright
npm run build        # mport -> index.html, importmap.json, styles/generated/wa.css, mport.lock.json
npm run serve        # http://127.0.0.1:4399/
# or both:
npm start
```

| Script | |
| --- | --- |
| `npm run build` | resolve through `mport.lock.json`; downloads and re-hashes the esm.sh files (a changed file fails the build) |
| `npm run build:offline` | the same, but CDN bytes come from `test/fixtures/cdn` (what CI and the tests use) |
| `node scripts/build.mjs --relock` | ignore the lockfile and resolve again (to update dayjs) |
| `npm run record:cdn` | refresh `test/fixtures/cdn` from the lockfile's hashes |
| `npm test` | Playwright on Chromium, Firefox and WebKit, hermetic (rebuilds offline first) |
| `npm run test:chromium` (or `:firefox`, `:webkit`) | one engine |
| `npm run test:smoke` | the app against the **real** CDN, no stubs (needs network and `npm run build`) |

## Tests

`test/e2e` (Playwright, three engines): boot with no console errors and no CSP or Trusted Types violations; windows
open, move (mouse, keyboard, touch) and dock; two layouts; the palette; forms submitted through the form-associated
components; data binding; state surviving a reload; two tabs in sync; dark mode; RTL; an axe scan with no serious or
critical violations (light, dark, palette open, RTL); the strict CSP; the import map, its integrity, and a tampered
CDN file being refused. Every request that is not for the local server is answered from recorded bytes
(`test/fixtures/cdn`, exactly the files whose hashes are in the import map) or refused, so the suite is hermetic. A
separate, non-gating CI job runs the same page against the real CDN.

## Layout

```
app/                 the shell: main.js, window chrome, tool glue (JS feeds data to components), index.template.html
components/          html-modules: kit.html (shared), notes.html, tasks.html, data.html, settings.html
scripts/             build.mjs (mport), local-registry.mjs, serve.mjs, record-cdn.mjs, offline-fetch.mjs
styles/app.css       the app's own CSS (generated/wa.css is window-algebra's, written by the build)
test/e2e/            Playwright specs;  test/fixtures/cdn/ recorded CDN bytes;  test/smoke/ real-CDN smoke
mport.lock.json      mport's lockfile: exact dayjs version, build and the integrity of every CDN file
```

## Findings

Every bug, gap and awkward API met while building this. **Fixed** items are in the library's `main` (the sha is the
fix, with a regression test; `package.json` pins a commit at or after it). **Issue** items are filed.

| | Library | Finding | Status |
| --- | --- | --- | --- |
| M1 | mport | `build({ graph: true })` threw `TypeError: Invalid URL` when a `local()` module was in the build | fixed `0936131` |
| M2 | mport | docs and example 12 printed `modulepreload` before the import map; Firefox then ignores the map | fixed `f5417e8` |
| M3 | mport | `local()` cannot serve a package that is not on npm (it asks the registry for version and entry) | [issue #1](https://github.com/johnhenry/mport/issues/1); workaround [`scripts/local-registry.mjs`](scripts/local-registry.mjs) |
| M4 | mport | no way to get the CSP hash of the inline import map (static sites cannot use a nonce) | [issue #2](https://github.com/johnhenry/mport/issues/2); workaround in [`build.mjs`](scripts/build.mjs) |
| H1 | html-modules | an invalid `form-control` component could not be focused on submit (Firefox: console error, no message) | fixed `262fe1e` |
| H2 | html-modules | `<html-import>` and friends are not hidden, so they become grid/flex items | fixed (docs) `262fe1e` |
| H3 | html-modules | Chromium logs a `style-src-elem` CSP error per `<style>` in every module | [issue #4](https://github.com/johnhenry/html-modules/issues/4); the build hashes the styles into `style-src` |
| H4 | html-modules | Enter does not submit a form of form-associated components; a component cannot be a submit button | [issue #5](https://github.com/johnhenry/html-modules/issues/5); `requestSubmit()` glue |
| H5 | html-modules | no loops in templates; adopting a stylesheet and registering a namespace takes two imports | wontfix (documented design) |
| W1 | window-algebra | palette: "new window" did not find "Open window" (keyword order) | fixed `a4307cf` |
| W2 | window-algebra | `attachSync`: a closed tab stayed in `peers()` for ever | fixed `2d28804` |
| W3 | window-algebra | `attachSync`: `peers()` was one-sided (a tab with no history never answered `hello`) | fixed `c8b415d` |
| W4 | window-algebra | `BASE_CSS` and the palette inject `<style>`, blocked by a strict `style-src` | fixed (docs) `4c0c3c1`; CSS written to a file |
| W5 | window-algebra | no built-in window chrome (title bar, buttons, grips): every app rewrites it | [issue #1](https://github.com/johnhenry/window-algebra/issues/1) |
| W6 | window-algebra | `<wa-stage>` hides the `sync` and `palette` handles it creates | [issue #2](https://github.com/johnhenry/window-algebra/issues/2) |
| W7 | window-algebra | `config.direction` is deliberately not synced between tabs | wontfix (documented design) |

Notes on environments rather than libraries: `package-lock.json` records the git dependencies as `git+ssh://`, so CI
rewrites that to https before `npm ci`; Firefox does not launch in the author's sandbox, so it runs in CI only; in
Playwright's Firefox a touch tap on a `<slot>` inside a shadow `<button>` delivers only pointer events (measured with
plain shadow-DOM buttons, so not library code), so taps on the kit buttons are asserted in Chromium and WebKit.

## License

MIT
