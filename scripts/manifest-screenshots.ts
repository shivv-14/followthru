// Captures the two PWA manifest screenshots from a running app (npm run dev or preview).
// Usage: npx tsx scripts/manifest-screenshots.ts [baseUrl]   (default http://localhost:5173)
import { mkdirSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'

const base = process.argv[2] ?? 'http://localhost:5173'

async function loadDemo(page: Page) {
  await page.goto(`${base}/setup`)
  await page.getByLabel('Your name').fill('Demo')
  await page.getByRole('button', { name: 'Use synthetic demo data (not the challenge fixture)' }).click()
  await page.getByText('Ready to load').waitFor()
  await page.getByRole('button', { name: 'Load and continue' }).click()
  await page.getByRole('button', { name: 'Continue as Priya' }).click()
  await page.getByRole('heading', { name: 'What needs attention' }).waitFor()
}

async function main() {
  mkdirSync('public/screenshots', { recursive: true })
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' })
  const wide = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await loadDemo(wide)
  await wide.screenshot({ path: 'public/screenshots/wide.png' })
  const narrow = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await loadDemo(narrow)
  await narrow.goto(`${base}/queue`)
  await narrow.getByRole('heading', { name: 'Draft queue' }).waitFor()
  await narrow.screenshot({ path: 'public/screenshots/narrow.png' })
  await browser.close()
  console.log('Saved public/screenshots/wide.png and narrow.png')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
