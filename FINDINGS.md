# Findings

The question: do @johnhenry/mport, @johnhenry/html-modules and @johnhenry/window-algebra, which share no dependency, really "meet at the import map"?

**Verdict: yes.**

- **One shared map.** A single import map, generated at build time by mport, is the only thing the three share.
- **No cross-imports.** The libraries are bare specifiers mapped to installed files (`local()`), and none of them imports another.
- **Modules resolve through the same map.** `<html-import src="@workbench/ui/notes.html">` resolves through it (`"@workbench/ui/": "/components/"`), and so do the modules those modules import.
- **CDN integrity is enforced.** dayjs is mapped to esm.sh with an integrity entry for every file in its graph, and all three engines refuse a changed file.
- **The shell knows nothing about the components.** A window body is a plain custom element, so window-algebra needs no knowledge of html-modules.

Status keys: **fixed** (library sha, and the workbench commit that removed the workaround), **issue** (link), **wontfix** (why). The workbench now pins mport `928dd6b`, html-modules `2dd5a5f` and window-algebra `6b17bfc`.

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

- **M3: `local()` cannot serve a package that is not on npm.** **Fixed** in mport `4839b5b` (issue #1, closed): `installedRegistry({ root })` from `@johnhenry/mport/node`. Workaround removed in workbench `ec3cc82` (`scripts/local-registry.mjs`, 38 lines, deleted).

  ```js
  createRouter({ "*": local({ base: "/node_modules/" }) }, { probe: "none" })
    .build(["@scope/installed-from-git"]); // ResolutionError: not found in the registry
  ```

  Now: `createRouter(routes, { registry: installedRegistry({ root: new URL("node_modules/", root), fallback: createRegistry({ fetch }) }) })`. The installed version wins, and dayjs (not installed) falls through to the real registry. `test/e2e/build.spec.js` pins it.

- **M4: no helper for the CSP hash of the inline import map.** Static sites cannot use a nonce. **Fixed** in mport `8ccef5e` (issue #2, closed): `importMapHash()`, `renderImportMapCsp()`, `cspHash()`. Workaround removed in workbench `ec3cc82` (the regex that cut the tag off `renderImportMap()` and the `createHash` call).

  Now: `const { html, hash } = await renderImportMapCsp(importMap)`; `hash` comes quoted, ready for `script-src`, and `html` is written out unchanged. `test/e2e/build.spec.js` checks that the page carries the hashed text and that `importMapHash()` agrees.

- **M5: notes, not bugs.**
  - An app-owned prefix works with `custom("/components/{path}", { name: "app", build: "app" })` and needs no registry lookup. It is now a documented recipe (mport `d2b2f9b`), and a directory specifier (`@workbench/ui/`) routes to `"@workbench/ui/": "/components/"`; `test/e2e/build.spec.js` pins both.
  - The CLI still cannot express this build (it needs the registry override and the CSP step), so the build uses the API.
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

- **H3: under `style-src 'self'`, Chromium logs a `style-src-elem` CSP error for every `<style>` in every module.** **Fixed** in html-modules `c84f467` (issue #4, closed; follow-ups `0f80953`, `feab842`). Workaround removed in workbench `ec3cc82` (the build read every `components/*.html` and hashed each `<style>` into `style-src`).

  The cause was that Chromium CSP-checks DOMParser documents; template `innerHTML` and Range parses are not checked. The page logged 15 errors per load. Verified before removing the hashes: `style-src` is now just `'self'`, and `test/e2e/csp.spec.js` requires zero `style-src*` violation events and applied component styles in Chromium, Firefox and WebKit.

- **H4: pressing Enter does not submit a form of form-associated components, and a component cannot be a submit button.** **Fixed** in html-modules `686ec51` (issue #5, closed): Enter in a `form-control` input submits as native implicit submission does, and `form-role="submit"|"reset"` makes a component a button. Workaround removed in workbench `ec3cc82` (about 14 lines of keydown and click handlers across `notes.js`, `tasks.js` and `settings.js`).

  Now: `kit.html` exports `submit-button` (`form-associated form-role="submit"`); the forms use `<kit--submit-button>`, and `test/e2e/forms.spec.js` presses Enter, Space and clicks, and checks `event.submitter`.

- **H6: a `form-role` button whose template holds a native `<button>` was a nested interactive control.** **Fixed** in html-modules `71ac9ef` (found with `form-role="submit"` and a native button inside; reported by axe as `nested-interactive`, serious).

  ```html
  <html-export name="go" form-associated form-role="submit"><template><button type="button"><slot></slot></button></template></html-export>
  <form><x--go>Save</x--go></form>
  <!-- host: internals.role = "button" AND a native <button> inside: axe nested-interactive -->
  ```

  The role is now set only when the template holds no native control. Regression: `test/form.test.js`. The workbench's `submit-button` uses the native-button shape, and its axe scans cover it.

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
- **W5: no built-in window chrome.** **Fixed** in window-algebra `c6fd6e7` (issue #1, closed): `chrome` on `<wa-stage>` / `attachStage` / `createDomRenderer`, `chromeSurface`, `CHROME_CSS` and the `--wa-chrome-*` tokens. Workaround removed in workbench `ec3cc82` (`app/chrome.js`, 58 lines, and about 26 lines of `.wb-*` CSS, deleted). Now: `chrome: true`; the dock button is the library's "Tile window", and `BASE_CSS` (already written to `wa.css`) carries `CHROME_CSS`.
- **W6: `<wa-stage>` hides the sync and palette handles.** **Fixed** in window-algebra `c4731e2` (issue #2, closed): `stage.palette`, `stage.sync`, `stage.popouts`, `stage.renderer`. Workaround removed in workbench `ec3cc82` (the separate `<wa-palette>` element, `defineCommandPaletteElement` and the hand-made `attachSync`). Now: `stage.configure({ palette: { injectStyles: false }, sync: { channel, onSync } })`, the Commands button calls `stage.palette.open()`, and the tab count reads `stage.sync.peers()`. Handles are `null` until the stage is connected and are stale after another `configure()`, so read them again.
- **W8: Chromium left a hidden Restore button after a mouse click on Maximize of a tiled window.** **Fixed** in window-algebra `3fe88ea`. Found by the workbench's windows spec after moving to the built-in chrome (the old hand-written chrome relabelled buttons in JavaScript and never depended on the CSS toggle).

  ```js
  // chrome.html in window-algebra: tile the windows, use master-stack, then click Maximize on a window that is not first
  for (const id of ["notes", "long", "form"]) wm.dispatch({ type: "window/set-mode", id, mode: "tiled" });
  wm.setLayout({ type: "master-stack", ratio: 0.55 });
  // click "Maximize window: Settings" with a real mouse -> state is "maximized", data-status="maximized" is on the view,
  // but getComputedStyle(restoreButton).display === "none" until any stylesheet changes
  ```

  The renderer wrote the view's attributes (`data-status`) and then called `moveBefore()` to put the view into the overlay. Chromium does not carry a pending style invalidation across `moveBefore()`, so the descendants kept a stale style. It is timing dependent (a script `click()` or a dispatch usually restyled in time; a real click did not). The renderer now patches after placing. Regressions: `test/regressions.test.mjs` (the write follows the move) and `e2e/chrome.spec.mjs` (a real click, which fails without the fix in Chromium). I could not reduce it to a standalone page: a plain `moveBefore()` with a delay did not reproduce it.
- **W9: the chrome's body did not become focusable when its content grew after mount.** **Fixed** in window-algebra `3fe88ea` (axe `scrollable-region-focusable`, serious). The Data window's components render after the surface mounts, so the body scrolled without a tab stop; only a commit or a resize of the body re-checked it. Each child of the body is now observed. Regression: `e2e/chrome.spec.mjs` (a late-appended tall child), and the workbench's `chrome.spec.js` and axe scans.
- **W10: the window-algebra element spec flaked in WebKit.** Fixed in `3fe88ea` (test only): it closed a page to drop a tab from `peers()`, and Playwright's WebKit does not fire `pagehide` on `page.close()` (see W7). It now navigates away.
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
| DOMParser `<style>` CSP error (H3) | fixed, 0 reports | 0 reports | 0 reports |
| Nested interactive control in a `form-role` button (H6) | fixed | fixed | fixed |
| Restore button after a click on Maximize, tiled window (W8) | stale style, fixed | n/a | n/a |

In Playwright's Firefox, a touch tap on a `<slot>` inside a shadow `<button>` delivers only pointer events, with no click. This was measured with plain shadow-DOM buttons and does not involve library code.

## Environment

- **Git dependencies in CI.** `package-lock.json` records the git dependencies as `git+ssh://`, so CI rewrites them to https before `npm ci`.
- **Firefox runs in CI only.** It does not launch in the dev sandbox.
- **Node version.** The libraries ask for Node 26. Node 24 works locally with a warning; CI uses 26.
