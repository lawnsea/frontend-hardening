import { defineConfig, devices } from "@playwright/test";

// Headed, because Chromium's headless shell has no site isolation. Each test starts
// its own server, so they run one at a time.
export default defineConfig({
  testDir: "tests",
  workers: 1,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], headless: false } }],
});
