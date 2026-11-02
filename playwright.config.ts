import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev -- --port=5173",
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
