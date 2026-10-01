# workbench

[![CI](https://github.com/johnhenry/workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/johnhenry/workbench/actions/workflows/ci.yml)

**Live: <https://johnhenry.github.io/workbench/>** (GitHub Pages, deployed from CI; see [Deploy](#deploy)).

A small, real app that exists to test one claim: that four sibling libraries, which depend on nothing
from each other, **meet at the import map**.

| Library | Does | Docs |
| --- | --- | --- |
| [`@johnhenry/mport`](https://github.com/johnhenry/mport) | routes imports across CDNs and compiles them to an import map and a lockfile | [opensource.johnhenry.me/mport](https://opensource.johnhenry.me/mport/) |
| [`@johnhenry/html-modules`](https://github.com/johnhenry/html-modules) | declarative Web Components in ordinary `.html` files | [opensource.johnhenry.me/html-modules](https://opensource.johnhenry.me/html-modules/) |
| [`@johnhenry/window-algebra`](https://github.com/johnhenry/window-algebra) | a functional window manager: layouts, drag and dock, palette, sync | [opensource.johnhenry.me/window-algebra](https://opensource.johnhenry.me/window-algebra/) |
| [`@johnhenry/safe-fragment`](https://github.com/johnhenry/safe-fragment) | renders untrusted HTML into live DOM only through a versioned allowlist profile (native Sanitizer API, or DOMPurify) | [opensource.johnhenry.me/safe-fragment](https://opensource.johnhenry.me/safe-fragment/) |

The claim holds: the import map is a real seam, and the page needs no bundler. The friction was in the details;
[what was found](#findings) is listed below. Every gap the first three libraries showed has been fixed and the
workarounds removed; safe-fragment, added since, has one open issue (S1).

## What it is

A workbench with five tool windows (notes, tasks, a data view, clips, settings) in a tiling window manager.

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
- **Untrusted rich text** (safe-fragment): a note's body is pasted HTML. It is rendered by `<safe-fragment profile="article-v1">`
  inside each note card, and the "Clips" tool loads a module from a less-trusted origin through html-modules' `sanitize`
  hook. See [Untrusted rich text](#untrusted-rich-text-safe-fragment).
- **Strict CSP**: a meta CSP with `require-trusted-types-for 'script'`, `trusted-types html-modules dompurify`,
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
- **mport → safe-fragment (and its dependency).** safe-fragment's DOMPurify fallback is a dynamic `import("dompurify")`: a bare
  specifier the page's map must cover. The build lists only `@johnhenry/safe-fragment`; `build({ dependencies: true })` reads its
  manifest and adds `dompurify` at the exact version it pins (the router needs a `dompurify` route of its own, see S3).
- **html-modules ↔ safe-fragment.** Neither depends on the other. The page passes safe-fragment to html-modules' adapter
  (`safeFragmentSanitizer`), and uses `<safe-fragment>` as an ordinary custom element inside a component template.
- **mport → the page.** dayjs is not installed. The map points it at esm.sh, with an `integrity` hash for every
  file of its import graph, so a changed CDN file is refused by the engine.

## Untrusted rich text (safe-fragment)

Both halves of the integration run on the engine the browser has: the **native HTML Sanitizer API** (`setHTML`, Chromium and Firefox)
or **DOMPurify** (WebKit has no `setHTML`; safe-fragment loads it on demand through the import map). The page's CSP allows only
the Trusted Types policies `html-modules` and `dompurify`, and no string ever reaches an HTML sink of ours.

1. **`<safe-fragment>` in the note view.** A note's body is untrusted rich text (pasted HTML). `components/notes.html`'s `note-card`
   holds `<safe-fragment profile="article-v1">`; `app/tools/notes.js` hands it the string as the `.html` property
   (markup goes through `article-v1`; text with no markup in it through `plain-text-v1`, which keeps its line breaks). The
   `safe-fragment:render` event's `SanitizationReport` comes back as a line in the card ("Sanitized (article-v1, dompurify): removed
   5: <script>, ...").
2. **html-modules' `sanitize` hook.** `components/untrusted/clip.html` stands for a module somebody else wrote: its template carries
   `<script>`, `<iframe srcdoc>`, `<svg onload>`, `javascript:` links, `onerror` and `onclick` handlers, a form. `app/tools/clips.js`
   imports it with `el.sanitize = safeFragmentSanitizer({ safeFragment, profile: { base: "article-v1", namespaces: ["clip"] } })`
   (`@johnhenry/html-modules/safe-fragment`). Every template is sanitized before the component is defined; the `{{heading}}`
   binding and the https link survive; what was removed arrives as `html-modules:sanitize` events and is listed in the Clips window.
3. **Through mport.** `@johnhenry/safe-fragment` and `@johnhenry/html-modules/safe-fragment` are in `SPECIFIERS`; `dompurify` is not:
   `router.build(SPECIFIERS, { graph: true, dependencies: true })` adds it. The status bar names the engine in use.

The tests (`test/e2e/safe-fragment.spec.js`, three engines) paste XSS payloads (img `onerror`, `javascript:` links, obfuscated
schemes, svg, `srcset` tricks, `<iframe srcdoc>`, a form with `formaction`, mXSS) into notes, once on the browser's own engine and once with
`Element.prototype.setHTML` removed (the DOMPurify path on every engine), and assert: nothing executes, benign formatting survives, the
report surfaces in the UI, the less-trusted module's template is sanitized, **zero CSP/Trusted Types violation events**, and axe stays
clean. One test removes the page's CSP altogether: the sanitizer alone still holds. Known gap: see S1 (parse-time CSP reports).

## Deploy

**<https://johnhenry.github.io/workbench/>**, from `.github/workflows/pages.yml` (Pages source: "GitHub Actions"):

1. `npm run build:pages` runs the same mport build with `--base /workbench/ --out dist`: the import map, the CSP and the
   `@workbench/ui/` prefix carry the base, and the libraries are **copied into `dist/vendor/`** (a static host serves no
   `node_modules`): `"@johnhenry/safe-fragment": "/workbench/vendor/@johnhenry/safe-fragment/dist/index.js"`. The page's own links are
   relative. `mport.lock.json` is read, not rewritten; dayjs still comes from esm.sh with its integrity hashes.
2. `actions/upload-pages-artifact` uploads `dist/`, `actions/deploy-pages` deploys it.
3. A Playwright job (`playwright.pages.config.js`, `test/pages/`) runs against the deployed URL on three engines (non-gating, so a CDN
   hiccup does not mark the deploy red). Locally: `npm run build:pages && npm run test:pages` serves `dist/` under `/workbench/` the way
   Pages does.

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
| `npm run build:pages` | the deployable site in `dist/` for the `/workbench/` subpath (libraries copied to `dist/vendor/`) |
| `npm run test:pages` | Playwright against `dist/` served under `/workbench/` (or `WORKBENCH_URL=<url>` against a deployed site) |
| `node scripts/build.mjs --relock` | ignore the lockfile and resolve again (to update dayjs) |
| `npm run record:cdn` | refresh `test/fixtures/cdn` from the lockfile's hashes |
| `npm test` | Playwright on Chromium, Firefox and WebKit, hermetic (rebuilds offline first) |
| `npm run test:chromium` (or `:firefox`, `:webkit`) | one engine |
| `npm run test:smoke` | the app against the **real** CDN, no stubs (needs network and `npm run build`) |

## Tests

`test/e2e` (Playwright, three engines; `safe-fragment.spec.js` is described above): boot with no console errors and no CSP or Trusted Types violations; windows
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
components/          html-modules: kit.html (shared), notes.html, tasks.html, data.html, clips.html, settings.html
components/untrusted/  a module loaded through the sanitize hook (safe-fragment)
scripts/             build.mjs (mport; --base/--out for the deployable site), serve.mjs, record-cdn.mjs, offline-fetch.mjs
styles/app.css       the app's own CSS (generated/wa.css is window-algebra's, written by the build)
test/e2e/            Playwright specs;  test/fixtures/cdn/ recorded CDN bytes;  test/smoke/ real-CDN smoke;  test/pages/ the deployed site
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
| S1 | safe-fragment | parsing input with `style=`, `<style>` or `<base>` reports CSP violations on Chromium (`style-src-attr`, `style-src-elem`, `base-uri`) although the output is clean | [issue #13](https://github.com/johnhenry/safe-fragment/issues/13) |
| S2 | safe-fragment | the native engine's report cannot list its own removals (script, frames, `on*`, `javascript:`), so "removed 1" can mean five | documented limit (ADR 0007); the UI says so |
| S3 | mport | a dependency found by `dependencies: true` is routed like any specifier: with `"*": esmSh()` dompurify went to esm.sh, not next to its dependent | documented; needs its own route (`dompurify: local()`) |
| S4 | safe-fragment | `article-v1` has no sectioning elements (`article`, `section`, `header`, ...): they are unwrapped | profile decision, noted |
| S5 | safe-fragment | Firefox's native engine leaves a bare `<img src="x">` for the `<noscript>` mXSS payload (scripting flag on) | known, in safe-fragment's corpus |
| W8 | window-algebra | Chromium: a mouse click on Maximize of a tiled window left the Restore button hidden (attributes written before `moveBefore()`) | fixed `3fe88ea` |
| W9 | window-algebra | the chrome's scrolling body was not focusable when its content rendered after mount (axe) | fixed `3fe88ea` |

Notes on environments rather than libraries: `package-lock.json` records the git dependencies as `git+ssh://`, so CI
rewrites that to https before `npm ci`; Firefox does not launch in the author's sandbox, so it runs in CI only; in
Playwright's Firefox a touch tap on a `<slot>` inside a shadow `<button>` delivers only pointer events (measured with
plain shadow-DOM buttons, so not library code), so taps on the kit buttons are asserted in Chromium and WebKit.

## License

MIT
