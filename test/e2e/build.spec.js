import { readFile } from "node:fs/promises";
import { importMapHash, cspHash, renderImportMapCsp, createRouter, custom, local } from "@johnhenry/mport";
import { installedRegistry } from "@johnhenry/mport/node";
import { test, expect } from "@playwright/test";

// The build's mport features, checked against what it wrote. No browser involved.
const root = new URL("../../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const map = JSON.parse(await readFile(new URL("importmap.json", root), "utf8"));

test.describe("build: mport features", () => {
  test("the CSP hash is importMapHash() of the map, and the page carries exactly the text it hashed (mport#2)", async () => {
    const { html: tag, hash, text } = await renderImportMapCsp(map);
    expect(hash).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/); // quotes included, ready for a CSP source list
    expect(await importMapHash(map)).toBe(hash);
    expect(await cspHash(text)).toBe(hash);
    expect(html).toContain(tag);
    const csp = /Content-Security-Policy" content="([^"]*)"/.exec(html)[1];
    expect(csp).toContain(`script-src 'self' ${hash}`);
  });

  test("installedRegistry() serves the git-installed libraries at their installed version, with no registry lookup (mport#1)", async () => {
    const registry = installedRegistry({ root: new URL("node_modules/", root) });
    const pkg = JSON.parse(await readFile(new URL("node_modules/@johnhenry/window-algebra/package.json", root), "utf8"));
    expect(await registry.version({ name: "@johnhenry/window-algebra", registry: "npm" })).toBe(pkg.version);
    const router = createRouter({ "@johnhenry/*": local({ base: "/node_modules/" }) }, { registry, probe: "none" });
    const { importMap } = await router.build(["@johnhenry/window-algebra/element"]);
    expect(importMap.imports["@johnhenry/window-algebra/element"]).toMatch(/^\/node_modules\/@johnhenry\/window-algebra\/.+\.mjs$/);
    // a package that is not installed is an error, not a network call
    await expect(registry.version({ name: "left-pad", registry: "npm" })).rejects.toThrow(/not installed/);
  });

  test("the app-owned prefix recipe custom('/components/{path}') routes a directory specifier to /components/ (mport)", async () => {
    const router = createRouter({ "@workbench/*": custom("/components/{path}", { name: "app", build: "app" }) }, { probe: "none" });
    const { importMap } = await router.build(["@workbench/ui/"]);
    expect(importMap.imports).toEqual({ "@workbench/ui/": "/components/" });
    expect(map.imports["@workbench/ui/"]).toBe("/components/");
  });

  test("the build no longer carries the workarounds it replaced", async () => {
    const build = await readFile(new URL("scripts/build.mjs", root), "utf8");
    expect(build).not.toMatch(/localRegistry|local-registry/);
    expect(build).not.toMatch(/createHash|styleHashes/);
    expect(build).toContain("installedRegistry");
    expect(build).toContain("renderImportMapCsp");
  });
});
