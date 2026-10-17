import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function loadDemoAs(page: Page, person: string) {
  await page.goto('/setup')
  await page.getByLabel('Your name').fill('Browser check')
  await page.getByRole('button', { name: 'Use synthetic demo data (not the challenge fixture)' }).click()
  await expect(page.getByText('Ready to load')).toBeVisible()
  await page.getByRole('button', { name: 'Load and continue' }).click()
  await page.getByRole('button', { name: `Continue as ${person}` }).click()
  await expect(page.getByRole('heading', { name: 'What needs attention' })).toBeVisible()
}

async function scan(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  // Report serious problems by rule and target so a failure says what to fix
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

test.describe('accessibility', () => {
  test('landing has no serious WCAG A/AA problems', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText("Chase what's late.")).toBeVisible()
    await page.waitForTimeout(1500) // let the entrance animations finish before checking contrast
    expect(await scan(page)).toEqual([])
  })

  for (const path of ['/dashboard', '/queue', '/commitments', '/commitments/c_m_03', '/team', '/evidence', '/flows']) {
    test(`app page ${path} has no serious WCAG A/AA problems`, async ({ page }) => {
      await loadDemoAs(page, 'Priya')
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(400)
      expect(await scan(page)).toEqual([])
    })
  }
})

test.describe('responsive sweep', () => {
  for (const width of [360, 390, 768, 1024, 1440]) {
    test(`no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 })
      await page.goto('/')
      await expect(page.getByText("Chase what's late.")).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      await loadDemoAs(page, 'Priya')
      for (const path of ['/dashboard', '/queue', '/commitments/c_m_03', '/evidence']) {
        await page.goto(path)
        await page.waitForLoadState('networkidle')
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(0)
      }
    })
  }
})

test.describe('reduced motion', () => {
  test('landing shows the story statically and keeps videos still', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await expect(page.getByText("Chase what's late.")).toBeVisible()
    await expect(page.locator('.sc--static')).toHaveCount(1)
    await expect(page.getByText('Quiet never')).toBeVisible()
    expect(await page.locator('.lh-video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  })
})
