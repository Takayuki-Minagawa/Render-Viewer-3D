import { defineConfig, devices } from '@playwright/test';
const preview = process.env.RV3D_PREVIEW === '1';
const port = preview ? 4174 : 4173;
export default defineConfig({
  testDir: './tests/e2e', timeout: 60000, workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}/Render-Viewer-3D/`, trace: 'retain-on-failure' },
  webServer: { command: `npm run ${preview ? 'preview' : 'dev'} -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}/Render-Viewer-3D/`, reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
