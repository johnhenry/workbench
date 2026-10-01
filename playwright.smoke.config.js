import { defineConfig, devices } from "@playwright/test";

// Non-gating: the same page against the REAL CDN (no page.route stubs). Run after `npm run build`.
const PORT = Number(process.env.WORKBENCH_PORT ?? 4399);
export default defineConfig({
  testDir: "./test/smoke",
  timeout: 60_000,
  retries: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, timezoneId: "UTC", locale: "en-US" },
  webServer: { command: `node scripts/serve.mjs ${PORT}`, url: `http://127.0.0.1:${PORT}/`, reuseExistingServer: !process.env.CI },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
