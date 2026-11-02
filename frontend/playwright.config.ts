import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
  throw new Error(
    "Set E2E_BASE_URL to the deployed site, such as https://app.example.com",
  );
}

// Never in CI: it runs against a deployed site and writes a real request.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
});
