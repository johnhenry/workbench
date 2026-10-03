# Findings

The question: do @johnhenry/mport, @johnhenry/html-modules, @johnhenry/window-algebra and @johnhenry/safe-fragment, which share no dependency, really "meet at the import map"?

**Verdict: yes.**

- **One shared map.** A single import map, generated at build time by mport, is the only thing the three share.
- **No cross-imports.** The libraries are bare specifiers mapped to installed files (`local()`), and none of them imports another.
- **Modules resolve through the same map.** `<html-import src="@workbench/ui/notes.html">` resolves through it (`"@workbench/ui/": "/components/"`), and so do the modules those modules import.
- **CDN integrity is enforced.** dayjs is mapped to esm.sh with an integrity entry for every file in its graph, and all three engines refuse a changed file.
- **The shell knows nothing about the components.** A window body is a plain custom element, so window-algebra needs no knowledge of html-modules.
- **The fourth library joins the same way.** safe-fragment and its dompurify dependency are import-map entries (the second one added by mport's `dependencies: true`); html-modules' `sanitize` hook takes safe-fragment as an argument, and `<safe-fragment>` is just another custom element in a template. Neither imports the other. Under the strict CSP with Trusted Types (`trusted-types html-modules dompurify`) the DOMPurify path (WebKit's only one) works, and the whole app deploys unchanged to a subpath.

Status keys: **fixed** (library sha, and the workbench commit that removed the workaround), **issue** (link), **wontfix** (why). The workbench now pins mport `f5109bf`, html-modules `b410edd`, window-algebra `fe20af1` and safe-fragment `0.0.0` (npm).

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

## safe-fragment

Added as the fourth library: note bodies are untrusted rich text, rendered with `<safe-fragment profile="article-v1">`, and the Clips tool loads `components/untrusted/clip.html` through html-modules' `sanitize` hook (`safeFragmentSanitizer`). Everything below was measured with the dist built by safe-fragment's own `prepare` script from the pinned git sha (`5717e52`; the empty-package problem of safe-fragment#10 is fixed, `npm ci` gets a working `dist/`).

- **S1: parsing hostile input reports CSP violations on Chromium, though the output is clean.** **Issue**: [safe-fragment#13](https://github.com/johnhenry/safe-fragment/issues/13).

  ```js
  // page CSP: style-src 'self'; base-uri 'none'
  await sanitizeToFragment('<p style="color:red">x</p>', { profile: "article-v1" });   // native: 2x style-src-attr
  await sanitizeToFragment("<style>p{color:red}</style><p>x</p>", { profile: "article-v1" }); // dompurify: 2x style-src-elem
  await sanitizeToFragment('<p>x</p><base href="https://example.com/">', { profile: "article-v1" }); // dompurify: 4x base-uri
  ```

  Each is a `securitypolicyviolation` event and a console error (Chromium; WebKit reports nothing). The sanitized output is right and nothing runs, but an app with `report-to` gets a report per pasted paragraph that has a `style` attribute. The workbench's "zero CSP violations" assertions therefore use payloads without those three constructs, and one dedicated test (`input with style=, <style> or <base>`) pins that **only** `style-src-attr`, `style-src-elem` and `base-uri` reports may appear for them (no `script-src`, `img-src` or Trusted Types report), so a regression elsewhere is still caught. Remove that test's allowance when #13 is fixed.

- **S2: the native engine's report lists only part of what it removed.** Documented (safe-fragment ADR 0007, `AGENTS.md`), not an issue. For `<p>hi <img onerror=…></p><script>…</script><a href="javascript:…">j</a><svg onload=…></svg><iframe srcdoc=…>` the report says `removed 1: <svg>` on Chromium's native engine and `removed 5: <script>, <svg>, <iframe>, img[onerror], a[href]` on DOMPurify; the rendered DOM is identical. The workbench's report line therefore says "(the native engine's own removals are not listed)" instead of presenting a count as complete, and the tests assert only what both engines share (`<svg>`) plus the full list under DOMPurify.
- **S3: a dependency found by `dependencies: true` is routed like any specifier.** mport behaves as documented ("a dependency can land on a different provider than its dependent"), and it is easy to trip over: with the routes `{ "@johnhenry/*": local(), "*": esmSh() }`, `build(["@johnhenry/safe-fragment"], { dependencies: true })` added `dompurify` from **esm.sh** (the offline build then failed to hash `https://esm.sh/dompurify@3.4.16`). Without a `*` route it is reported under `dependencies.skipped`, not thrown. The fix is one route, `dompurify: local({ base })`, after which the map has `"dompurify": "/node_modules/dompurify/dist/purify.es.mjs"` at the version safe-fragment pins (3.4.16) and `mport.lock.json` records `dompurify@3.4.16`. `test/e2e/build.spec.js` pins this; the build prints what `dependencies` added and any non-trivial skip.
- **S4: `article-v1` has no sectioning elements.** `<article>`, `<section>`, `<header>`, `<footer>`, `<nav>`, `<main>` are unwrapped (their content stays), so a pasted web page loses its structure and a module template that uses `<article>` loses the element, and the styling hook with it (the Clips card's CSS targets `h3`, not `article`). A profile derived with `registerTemplateProfile({ base: "article-v1" })` has the same list. It is a profile decision rather than a bug; derive a profile to add them.
- **S5: Firefox's native engine leaves a bare `<img src="x">` for the `<noscript>` mXSS payload.** Known and documented in safe-fragment (`test/fixtures/xss-corpus.ts`: "Firefox's native `setHTML` parses with the scripting flag ENABLED"), so not an issue. `<noscript><p title="</noscript><img src=x onerror=…>">…` ends the noscript at the first `</noscript>`, the `<img>` is real markup, the profile strips its handler and keeps the (relative, allowed) `src`. Found by workbench's first CI run: axe reported `image-alt` on that `img` in Firefox only, which is why the item is not in the shared payload; it is in the parse-time test, which asserts that no handler survives and nothing runs.
- **S6: what works, measured.** The DOMPurify path under `require-trusted-types-for 'script'` works with exactly `trusted-types html-modules dompurify` (no `'allow-duplicates'`): in WebKit natively, and in Chromium and Firefox with `Element.prototype.setHTML` removed (every safe-fragment test runs both ways). `registerSafeFragment()` once at startup, `await preloadSanitizer()` to surface a missing `dompurify` map entry early (its result names the engine, shown in the status bar), and `.html` set as a property on a `<safe-fragment>` that lives in a component's shadow root all behave as documented. The adapter keeps `{{heading}}` bindings in a sanitized template, drops `<script>`, `<iframe>`, `<svg>`, `<form>`, handlers, `javascript:` hrefs and `style=`, forces `rel="noopener noreferrer"` on `target="_blank"`, and refuses nothing it should not (a sanitized module's `<style>` export is outside the sanitizer, as documented: the Clips stylesheet still applies).

## Deploy (GitHub Pages)

Not a library finding; what a subpath deploy needed from the app and from mport.

- **The page must not assume it is at `/`.** mport's `local({ base })` and `custom("<base>components/{path}")` take the base, so the same build emits `/workbench/vendor/...` and `"@workbench/ui/": "/workbench/components/"`; the template's own links became relative. A relative URL inside **sanitized content** resolves against the document, not the module: the Clips card's `<img src="/favicon.svg">` was a 404 at `/workbench/` (found by the deployed-site test as a console error), so it is `src="favicon.svg"` now.
- **Libraries are copied into the artifact** (`dist/vendor/`), not served from `node_modules`, and mport's map points there. `mport.lock.json` pins versions, not URLs, so one lockfile serves both builds.
- **The CSP and the integrity hash stay correct** because the map is rendered after the base is known (`renderImportMapCsp()`); a changed base changes the hash, not a hand-edited string.

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
| Sanitizer engine for `<safe-fragment>` and the hook | native (`setHTML`) | native (CI) | DOMPurify (no `setHTML`) |
| DOMPurify path under `trusted-types html-modules dompurify` (forced where `setHTML` exists) | works | works (CI) | works |
| `<noscript>` payload through the native engine (S5) | nothing left | bare `<img src="x">` | n/a (DOMPurify) |
| Parse-time CSP reports for `style=` / `<style>` / `<base>` input (S1) | reports (native: attr; DOMPurify: attr, elem, base-uri) | not measured (CI only; the test allows them) | none |
| Native report lists the engine's own removals (S2) | no | no | n/a (DOMPurify lists them) |

In Playwright's Firefox, a touch tap on a `<slot>` inside a shadow `<button>` delivers only pointer events, with no click. This was measured with plain shadow-DOM buttons and does not involve library code.

## Environment

- **Git dependencies in CI.** `package-lock.json` records the git dependencies as `git+ssh://`, so CI rewrites them to https before `npm ci`.
- **Firefox runs in CI only.** It does not launch in the dev sandbox.
- **Node version.** The libraries ask for Node 26. Node 24 works locally with a warning; CI uses 26.
