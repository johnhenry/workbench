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
[what was found](#findings) is listed below, and every gap it found has since been fixed in the libraries and the
workarounds removed.

## What it is

A workbench with four tool windows (notes, tasks, a data view, settings) in a tiling window manager.

- **Shell** (window-algebra): `<wa-stage>` with two layouts (master-stack and grid) plus floating windows, the
  built-in window chrome (`chrome: true`: title bar, buttons, resize grips), drag to move, dock and reorder, the
  command palette (`Ctrl/Cmd+Shift+P`, or the Commands button through `stage.palette`), keyboard moving
  (`Alt+Shift+Arrows`), touch (drag, pinch, long-press to float or dock), light/dark theming through `--wa-*` tokens,
  right-to-left, `serialize()`/`load()` to `localStorage`, and cross-tab sync (`stage.sync`).
- **Components** (html-modules): everything inside a window is an HTML module in [`components/`](components):
  data-bound templates (`{{attr}}` and `props`), form-associated fields used in three real forms (Enter submits, and
  `kit--submit-button` is a real `form-role="submit"` component), a stylesheet export, and a shared `kit.html` that
  every tool module imports (modules importing modules).
- **Import map** (mport): `npm run build` asks mport for the page's import map and lockfile and writes `index.html`
  with `renderImportMapCsp()` (the tag and its CSP hash) and `renderModulePreload()`.
- **A real third-party package**: `dayjs` (and its `relativeTime` plugin) from esm.sh, formatting due dates and
  "updated" times, pinned by `mport.lock.json` with `graph` integrity.
- **Strict CSP**: a meta CSP with `require-trusted-types-for 'script'`, `trusted-types html-modules`,
  `style-src 'self'` (no hashes), no `'unsafe-inline'` and no `'unsafe-eval'`.

## How the three fit together

```
                         build time (Node)                                  run time (browser)

  mport.lock.json ─┐
  scripts/build.mjs│  createRouter({                                   ┌──────────────────────────────┐
                   ├─►   "@johnhenry/*":  local() + installedRegistry()─┤ <script type="importmap">    │
  node_modules/    │     "@workbench/*":  custom("/components/{path}") │  "@johnhenry/window-algebra" │
   @johnhenry/*    │     "*":             esmSh()    ── esm.sh ────────┤  "@johnhenry/html-modules/…" │
                   │   }).build(specs, { graph: true })                │  "@workbench/ui/"  (prefix)  │
                   │         │                                         │  "dayjs", "dayjs/plugin/…"   │
                   │         ▼                                         │  "integrity": { esm.sh files }│
                   │   renderImportMapCsp() + renderModulePreload()    └───────┬───────────┬──────────┘
                   │   + CSP (hash of the map; style-src is 'self')            │           │
                   └──►  index.html                                            │           │
                                                                               ▼           ▼
        <html-import src="@workbench/ui/notes.html">  ──────────────►  html-modules   window-algebra
          resolves through the import map to /components/notes.html     (components)   (windows)
                                                                               │           │
                  kit.html  ◄── imported by every tool module                  └─────┬─────┘
                                                                                     ▼
                          the stage's chrome body holds a surface: <wb--notes-tool>…
```

- **mport → html-modules.** An `<html-import src>` that is not a URL is resolved with `import.meta.resolve`, which
  applies the page's import map. mport emits `"@workbench/ui/": "/components/"`, so `src="@workbench/ui/notes.html"`
  loads `/components/notes.html`, and modules import each other the same way.
- **mport → window-algebra.** The shell imports `@johnhenry/window-algebra`, `/browser` and `/element` by bare name;
  mport maps each to the installed file (`local()` with `installedRegistry()`, because they are not on npm). The two
  libraries never import each other.
- **html-modules → window-algebra.** A window is a surface that mounts an element. An html-modules component is a
  plain custom element, so a window's body is just `document.createElement("wb--notes-tool")`, mounted into the
  chrome body that window-algebra draws.
- **window-algebra owns the shell's moving parts.** `<wa-stage>` draws the chrome and owns the palette and the
  cross-tab sync, so the app reads `stage.palette` and `stage.sync` instead of wiring a `<wa-palette>` and
  `attachSync` itself. It writes no `<style>`: its CSS (`CHROME_CSS` included) is written to
  `styles/generated/wa.css` by the build.
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
open, move (mouse, keyboard, touch) and dock; two layouts; the built-in chrome; the palette (shortcut, and the button
through `stage.palette`); forms submitted through the form-associated components, with Enter and the real submit-button
component; data binding; state surviving a reload; two tabs in sync; dark mode; RTL; an axe scan with no serious or
critical violations (light, dark, palette open, RTL); the strict CSP (and no `style-src` report in any engine); the import map, its integrity, a tampered CDN file being refused,
and the build's mport features (`installedRegistry()`, `importMapHash()`, the app-owned prefix). Every request that is not for the local server is answered from recorded bytes
(`test/fixtures/cdn`, exactly the files whose hashes are in the import map) or refused, so the suite is hermetic. A
separate, non-gating CI job runs the same page against the real CDN.

## Layout

```
app/                 the shell: main.js, tool glue (JS feeds data to components), index.template.html
components/          html-modules: kit.html (shared), notes.html, tasks.html, data.html, settings.html
scripts/             build.mjs (mport), serve.mjs, record-cdn.mjs, offline-fetch.mjs
styles/app.css       the app's own CSS (generated/wa.css is window-algebra's, written by the build)
test/e2e/            Playwright specs;  test/fixtures/cdn/ recorded CDN bytes;  test/smoke/ real-CDN smoke
mport.lock.json      mport's lockfile: exact dayjs version, build and the integrity of every CDN file
```

## Findings

Every bug, gap and awkward API met while building this. **Fixed** items are in the library's `main` (the sha is the
fix, with a regression test; `package.json` pins a commit at or after it) and the workbench workaround is gone
(`workbench ec3cc82`). Each one has a minimal repro in [FINDINGS.md](FINDINGS.md).

| | Library | Finding | Status |
| --- | --- | --- | --- |
| M1 | mport | `build({ graph: true })` threw `TypeError: Invalid URL` when a `local()` module was in the build | fixed `0936131` |
| M2 | mport | docs and example 12 printed `modulepreload` before the import map; Firefox then ignores the map | fixed `f5417e8` |
| M3 | mport | `local()` cannot serve a package that is not on npm (it asks the registry for version and entry) | fixed `4839b5b` (`installedRegistry()`); workaround removed in `ec3cc82` |
| M4 | mport | no way to get the CSP hash of the inline import map (static sites cannot use a nonce) | fixed `8ccef5e` (`importMapHash()`, `renderImportMapCsp()`); workaround removed in `ec3cc82` |
| H1 | html-modules | an invalid `form-control` component could not be focused on submit (Firefox: console error, no message) | fixed `262fe1e` |
| H2 | html-modules | `<html-import>` and friends are not hidden, so they become grid/flex items | fixed (docs) `262fe1e` |
| H3 | html-modules | Chromium logs a `style-src-elem` CSP error per `<style>` in every module | fixed `c84f467`; style hashing removed in `ec3cc82` |
| H4 | html-modules | Enter does not submit a form of form-associated components; a component cannot be a submit button | fixed `686ec51` (`form-role`); `requestSubmit()` glue removed in `ec3cc82` |
| H6 | html-modules | a `form-role` button with a native `<button>` inside was a nested interactive control (axe) | fixed `71ac9ef` |
| H5 | html-modules | no loops in templates; adopting a stylesheet and registering a namespace takes two imports | wontfix (documented design) |
| W1 | window-algebra | palette: "new window" did not find "Open window" (keyword order) | fixed `a4307cf` |
| W2 | window-algebra | `attachSync`: a closed tab stayed in `peers()` for ever | fixed `2d28804` |
| W3 | window-algebra | `attachSync`: `peers()` was one-sided (a tab with no history never answered `hello`) | fixed `c8b415d` |
| W4 | window-algebra | `BASE_CSS` and the palette inject `<style>`, blocked by a strict `style-src` | fixed (docs) `4c0c3c1`; CSS written to a file |
| W5 | window-algebra | no built-in window chrome (title bar, buttons, grips): every app rewrites it | fixed `c6fd6e7`; `app/chrome.js` removed in `ec3cc82` |
| W6 | window-algebra | `<wa-stage>` hides the `sync` and `palette` handles it creates | fixed `c4731e2`; `<wa-palette>` and `attachSync` removed in `ec3cc82` |
| W7 | window-algebra | `config.direction` is deliberately not synced between tabs | wontfix (documented design) |
| W8 | window-algebra | Chromium: a mouse click on Maximize of a tiled window left the Restore button hidden (attributes written before `moveBefore()`) | fixed `3fe88ea` |
| W9 | window-algebra | the chrome's scrolling body was not focusable when its content rendered after mount (axe) | fixed `3fe88ea` |

Notes on environments rather than libraries: `package-lock.json` records the git dependencies as `git+ssh://`, so CI
rewrites that to https before `npm ci`; Firefox does not launch in the author's sandbox, so it runs in CI only; in
Playwright's Firefox a touch tap on a `<slot>` inside a shadow `<button>` delivers only pointer events (measured with
plain shadow-DOM buttons, so not library code), so taps on the kit buttons are asserted in Chromium and WebKit.

## License

MIT
