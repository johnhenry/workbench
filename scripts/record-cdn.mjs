// Record every CDN file the lockfile pins (its `files` map, written by `mport build --graph`) into
// test/fixtures/cdn, verifying each against the hash in the lock. The browser tests answer esm.sh
// requests from these bytes with page.route(), so the import map's `integrity` still verifies in the engine.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const lock = JSON.parse(await readFile(new URL("mport.lock.json", root), "utf8"));
const dir = new URL("test/fixtures/cdn/", root);
await mkdir(dir, { recursive: true });

const index = {};
for (const [url, expected] of Object.entries(lock.files ?? {})) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`record-cdn: ${url} responded ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const actual = `sha384-${createHash("sha384").update(bytes).digest("base64")}`;
  if (actual !== expected) throw new Error(`record-cdn: ${url} no longer matches mport.lock.json (${actual} != ${expected})`);
  const file = `${createHash("sha256").update(url).digest("hex").slice(0, 16)}.mjs`;
  await writeFile(new URL(file, dir), bytes);
  index[url] = { file, type: res.headers.get("content-type") ?? "text/javascript; charset=utf-8" };
  console.log(`recorded ${url} (${bytes.length} bytes)`);
}
await writeFile(new URL("index.json", dir), `${JSON.stringify(index, null, 2)}\n`);
