# Findings

The question: do @johnhenry/mport, @johnhenry/html-modules and @johnhenry/window-algebra, which share no dependency, really "meet at the import map"?

**Verdict: yes.**

- **One shared map.** A single import map, generated at build time by mport, is the only thing the three share.
- **No cross-imports.** The libraries are bare specifiers mapped to installed files (`local()`), and none of them imports another.
- **Modules resolve through the same map.** `<html-import src="@workbench/ui/notes.html">` resolves through it (`"@workbench/ui/": "/components/"`), and so do the modules those modules import.
- **CDN integrity is enforced.** dayjs is mapped to esm.sh with an integrity entry for every file in its graph, and all three engines refuse a changed file.
- **The shell knows nothing about the components.** A window body is a plain custom element, so window-algebra needs no knowledge of html-modules.

Status keys: **fixed** (repo + sha), **issue** (link), **wontfix** (why).

## mport

- **M1: `graph` crashes on a build that also contains a `local()` module.** Fixed in mport `0936131`.

  ```js
  createRouter(
    { "app-lib": provider({ name: "mine", needsVersion: false, url: (a) => `/vendor/${a.name}/index.js` }), "*": esmSh() },
    { probe: "none" },
  ).build(["app-lib", "react@19.2.0"], { graph: true }); // TypeError: Invalid URL
  ```

  `walkGraph` called `new URL("/node_modules/...")`. Such a module is now listed in `graph.skipped` and gets no integrity entry, while CDN packages in the same build are still hashed. The test is in `test/graph.test.mjs`.

- **M2: the docs and example 12 printed `modulepreload` before the import map, and Firefox 155 then ignores the map.** Fixed in mport `f5417e8`.

  ```html
  <link rel="modulepreload" href="/a.js">
  <script type="importmap">{"imports":{"lib":"/a.js"}}</script>
  <script type="module">import "lib"</script> <!-- Firefox: "lib" unresolved -->
  ```

  Chromium and WebKit accept either order. The docs, JSDoc and example 12 now put the map first, and `test/browser/runtime.spec.mjs` pins the behaviour per engine.

- **M3: `local()` cannot serve a package that is not on npm.** Issue: https://github.com/johnhenry/mport/issues/1

  ```js
  createRouter({ "*": local({ base: "/node_modules/" }) }, { probe: "none" })
    .build(["@scope/installed-from-git"]); // ResolutionError: not found in the registry
  ```

  Workaround: `scripts/local-registry.mjs`, passed as the router's `registry` option. It answers version, info, manifest, entryInfo and entry from the installed `package.json`.

- **M4: no helper for the CSP hash of the inline import map.** Static sites cannot use a nonce. Issue: https://github.com/johnhenry/mport/issues/2

  Workaround: `scripts/build.mjs` re-parses the `renderImportMap()` output and hashes it.

- **M5: notes, not bugs.**
  - An app-owned prefix works with `custom("/components/{path}", { name: "app", build: "app" })` and needs no registry lookup. The recipe is undocumented but works (wontfix).
  - The CLI cannot express this build: it needs the M3 registry override and the CSP step, so the build uses the API.
  - `graph` needs the network once. After that, the lockfile (exact version plus a hash of every file) keeps later builds safe, and `scripts/offline-fetch.mjs` answers the build's fetches from recorded bytes so CI is hermetic.

## html-modules

- **H1: an invalid `form-control` component could not be focused on submit.** Fixed in html-modules `262fe1e`.

  ```html
  <html-export name="note-field" form-associated form-control="input"><template><input></template></html-export>
  <form><x--note-field name="n" required></x--note-field></form>
  <!-- form.requestSubmit() -> Firefox: "The invalid form control with name='n' is not focusable", nothing focused -->
  ```

  `delegatesFocus` now defaults to true for an export with `form-control`. An explicit attribute or `<html-module-settings>` still wins. Tests: `test/form.test.js` (both readers plus the compiler) and `test/browser/form.spec.js` (all three engines).

- **H2: `<html-import>`, `<html-binding>` and the settings elements are not hidden, so they become grid/flex items.** Fixed (docs) in `262fe1e`.

- **H3: under `style-src 'self'`, Chromium logs a `style-src-elem` CSP error for every `<style>` in every module.** Issue: https://github.com/johnhenry/html-modules/issues/4

  The cause is that Chromium CSP-checks DOMParser documents; template `innerHTML` and Range parses are not checked. This page logs 15 errors per load. Workaround: the build hashes every `<style>` in `components/*.html` into `style-src`.

- **H4: pressing Enter does not submit a form of form-associated components, and a component cannot be a submit button.** Issue: https://github.com/johnhenry/html-modules/issues/5

  Workaround: keydown and delegated click handlers that call `form.requestSubmit()` (`app/tools/notes.js`).

- **H5: notes (wontfix, documented design).**
  - Templates have no loops, so lists are built in JS (`reconcile()` in `app/dom.js`).
  - Adopting a stylesheet export and registering a namespace takes two `<html-import>`s of the same module.
  - Data binding, props, form association and Trusted Types (the built-in `html-modules` policy, with no `innerHTML` in the app) all worked as documented.

## window-algebra

- **W1: the palette query "new window" did not find "Open window"** (its keywords are "new add"). It found "Pop window out" by accident. Fixed in window-algebra `a4307cf`.

  ```js
  paletteEntries(createState(), { query: "new window" })
  ```

- **W2: a closed tab stayed in `peers()` forever.** Fixed in window-algebra `2d28804`: a tab now sends `bye` on `pagehide` and `hello` on a bfcache `pageshow`, and the new `lifecycle` option controls this.
- **W3: `peers()` was one-sided, because a tab with no history never answered `hello`.** Fixed in window-algebra `c8b415d` with a presence reply.
- **W4: `BASE_CSS` and the palette inject `<style>`, which a strict `style-src` blocks.** Fixed (docs) in window-algebra `4c0c3c1`. Everything else uses the CSSOM, which CSP allows; write `BASE_CSS` and `PALETTE_CSS` to a file and pass `injectStyles: false`.
- **W5: no built-in window chrome.** Issue: https://github.com/johnhenry/window-algebra/issues/1
- **W6: `<wa-stage>` hides the sync and palette handles.** Issue: https://github.com/johnhenry/window-algebra/issues/2 (workaround: `<wa-palette>` plus `attachSync`).
- **W7: notes.**
  - `config.direction` is deliberately not synced between tabs (wontfix, documented). It is persisted.
  - Playwright's WebKit does not fire `pagehide` on `page.close()`, so the sync test navigates away instead.

## Engines

| | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| Import map in HTML | works | works | works |
| Import map after `modulepreload` | works | ignored (M2) | works |
| `integrity` refuses a changed CDN file | enforced | enforced | enforced |
| Trusted Types | enforced | enforced | enforced |
| DOMParser `<style>` CSP error (H3) | yes | no | no |

In Playwright's Firefox, a touch tap on a `<slot>` inside a shadow `<button>` delivers only pointer events, with no click. This was measured with plain shadow-DOM buttons and does not involve library code.

## Environment

- **Git dependencies in CI.** `package-lock.json` records the git dependencies as `git+ssh://`, so CI rewrites them to https before `npm ci`.
- **Firefox runs in CI only.** It does not launch in the dev sandbox.
- **Node version.** The libraries ask for Node 26. Node 24 works locally with a warning; CI uses 26.
