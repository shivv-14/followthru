import { defineConfig } from '@playwright/test'

// Service workers only register in a production build, so this suite serves `vite preview`.
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'pwa.spec.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', channel: process.env.PW_CHANNEL ?? 'chrome' },
  webServer: {
    command: 'npx tsc -b && npx vite build --mode demo && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    // The demo data option only appears in production builds with this flag
    env: { VITE_DEMO_MODE: 'true' },
    timeout: 180_000,
  },
})
