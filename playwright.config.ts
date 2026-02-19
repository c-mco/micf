import { defineConfig, devices } from '@playwright/test';
import { TEST_DB, TEST_PORT } from './playwright/global-setup';

export default defineConfig({
  testDir: './tests',
  globalSetup: './playwright/global-setup.ts',
  fullyParallel: false, // tests share the same server instance
  retries: 0,
  reporter: 'list',

  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
    // Give the page a moment to settle after filter changes
    actionTimeout: 5000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // Build then serve with the test DB on a separate port
    command: `go run . -db ${TEST_DB} -port ${TEST_PORT}`,
    port: TEST_PORT,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
