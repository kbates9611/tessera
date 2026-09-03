import { defineConfig, devices } from "@playwright/test";

const isolatedPort = process.env.TESSERA_E2E_PORT;
const baseURL = isolatedPort
  ? `http://127.0.0.1:${isolatedPort}`
  : "http://127.0.0.1:5178";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: isolatedPort
      ? `cross-env TESSERA_TEST_MODE=1 TESSERA_PORT=${isolatedPort} node server/index.mjs --production`
      : "npm run dev:test",
    url: baseURL,
    reuseExistingServer: !isolatedPort,
    timeout: 120_000,
  },
});
