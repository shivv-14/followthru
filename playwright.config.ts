import { defineConfig } from '@playwright/test'

// Uses the Chrome already installed on this machine (no browser download).
// These tests cover the browser-only demo mode, so they run their own dev server on :5174 with
// Vite mode "demo" (port 5173 may be running the Supabase cloud mode).
// Set PW_CHANNEL=msedge to use Edge instead.
export default defineConfig({
  testDir: 'e2e',
  testIgnore: 'pwa.spec.ts',
  timeout: 60_000,
  // The dev server can be slow right after a heavy command; give each assertion room
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:5174',
    channel: process.env.PW_CHANNEL ?? 'chrome',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5174 --strictPort --mode demo',
    url: 'http://localhost:5174',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
