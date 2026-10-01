// A registry client for packages that are installed in node_modules but not
// published to npm (the three @johnhenry libraries are installed from git).
//
// mport's local() provider still asks the npm registry for a package's version
// and entry file; for an unpublished package that is a 404. createRouter()
// accepts a `registry` client, so we answer those lookups from the installed
// package.json instead and delegate everything else to the real registry.
import { readFile } from "node:fs/promises";
import { createRegistry, entryInfo } from "@johnhenry/mport";

export function localRegistry({ root, scope = "@johnhenry/", fallback = createRegistry() }) {
  const manifests = new Map();
  const read = (name) => {
    if (!manifests.has(name)) manifests.set(name, readFile(new URL(`${name}/package.json`, root), "utf8").then(JSON.parse));
    return manifests.get(name);
  };
  const mine = (name) => name.startsWith(scope);
  return {
    async version(parsed) {
      if (!mine(parsed.name) || parsed.registry !== "npm") return fallback.version(parsed);
      return (await read(parsed.name)).version;
    },
    async info(reg, name) {
      if (!mine(name) || reg !== "npm") return fallback.info(reg, name);
      const { version } = await read(name);
      return { versions: [version], tags: { latest: version }, deprecated: new Set() };
    },
    async manifest(name, version) {
      return mine(name) ? read(name) : fallback.manifest(name, version);
    },
    async entryInfo(name, version, subpath = "") {
      return mine(name) ? entryInfo(await read(name), subpath) : fallback.entryInfo(name, version, subpath);
    },
    async entry(name, version, subpath = "") {
      return (await this.entryInfo(name, version, subpath)).file;
    },
  };
}
