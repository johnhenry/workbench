# workbench

[![CI](https://github.com/johnhenry/workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/johnhenry/workbench/actions/workflows/ci.yml)

A small, real app that exists to test one claim: that three sibling libraries, which depend on nothing
from each other, **meet at the import map**.

| Library | Does | Docs |
| --- | --- | --- |
| [`@johnhenry/mport`](https://github.com/johnhenry/mport) | routes imports across CDNs and compiles them to an import map and a lockfile | [opensource.johnhenry.me/mport](https://opensource.johnhenry.me/mport/) |
| [`@johnhenry/html-modules`](https://github.com/johnhenry/html-modules) | declarative Web Components in ordinary `.html` files | [opensource.johnhenry.me/html-modules](https://opensource.johnhenry.me/html-modules/) |
| [`@johnhenry/window-algebra`](https://github.com/johnhenry/window-algebra) | a functional window manager: layouts, drag and dock, palette, sync | [opensource.johnhenry.me/window-algebra](https://opensource.johnhenry.me/window-algebra/) |

The verdict, and every bug, gap and awkward API found on the way, is in [FINDINGS.md](FINDINGS.md).
Short version: the claim holds. The import map is a real seam, and the page needs no bundler. The friction
was in the details, and some of it is now fixed in the libraries.

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

## License

MIT
