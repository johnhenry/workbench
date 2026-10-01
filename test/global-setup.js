// Rebuild index.html from the lockfile and the recorded CDN bytes before every run, so the tests always
// exercise what `npm run build:offline` would produce (CSP hashes included).
import { execFileSync } from "node:child_process";

export default function globalSetup() {
  execFileSync(process.execPath, ["scripts/build.mjs", "--offline"], { stdio: "inherit" });
}
