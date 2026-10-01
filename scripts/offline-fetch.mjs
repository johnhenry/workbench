// A fetch() that answers CDN requests from recorded bytes (test/fixtures/cdn), so the build and the
// browser tests never touch the network. `npm run record:cdn` writes the fixtures from mport.lock.json.
import { readFile } from "node:fs/promises";

export async function offlineFetch(dir) {
  let index;
  try {
    index = JSON.parse(await readFile(new URL("index.json", dir), "utf8"));
  } catch {
    throw new Error("offline: no recorded CDN files; run `npm run build` then `npm run record:cdn` once, with network access");
  }
  return async (input) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    const entry = index[url];
    if (!entry) return new Response(`offline: ${url} is not in the recorded fixtures`, { status: 404 });
    return new Response(await readFile(new URL(entry.file, dir)), {
      status: 200,
      headers: { "content-type": entry.type },
    });
  };
}
