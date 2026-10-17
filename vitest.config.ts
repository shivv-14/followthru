import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Engine/schema tests (*.test.ts) run in node; component tests (*.test.tsx) in jsdom.
export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ['./tests/setup.ts'],
    projects: [
      {
        extends: true,
        test: { name: 'engine', environment: 'node', include: ['tests/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'ui', environment: 'jsdom', include: ['tests/**/*.test.tsx'] },
      },
    ],
  },
})
