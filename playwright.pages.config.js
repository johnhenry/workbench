import { defineConfig, devices } from "@playwright/test";

// The deployed site (GitHub Pages), real CDN, no stubs. WORKBENCH_URL is the site's URL, trailing slash included:
//   WORKBENCH_URL=https://johnhenry.github.io/workbench/ npx playwright test --config playwright.pages.config.js
// Without it, `npm run build:pages` output is served locally under the same subpath, the way Pages serves it.
const remote = process.env.WORKBENCH_URL;
const baseURL = remote ? remote.replace(/\/?$/, "/") : "http://127.0.0.1:4410/workbench/";

export default defineConfig({
  testDir: "./test/pages",
  testMatch: "**/*.spec.js",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 800 }, trace: "retain-on-failure" },
  ...(remote ? {} : {
    webServer: { command: "node scripts/serve.mjs 4410 --dir dist --prefix /workbench/", url: baseURL, reuseExistingServer: !process.env.CI, timeout: 20_000 },
  }),
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
