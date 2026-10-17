import { expect, test, type Page } from '@playwright/test'

function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

async function loadDemoAs(page: Page, person: string) {
  await page.goto('/setup')
  await page.getByLabel('Your name').fill('Browser check')
  await page.getByRole('button', { name: 'Use synthetic demo data (not the challenge fixture)' }).click()
  await expect(page.getByText('Ready to load')).toBeVisible()
  await page.getByRole('button', { name: 'Load and continue' }).click()
  await expect(page.getByRole('heading', { name: 'Choose a profile' })).toBeVisible()
  await page.getByRole('button', { name: `Continue as ${person}` }).click()
}

test('coordinator journey: setup, dashboard, approve, evidence', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/')
  await expect(page.getByText("Chase what's late.")).toBeVisible()
  await page.getByRole('link', { name: 'Open app' }).click()
  await loadDemoAs(page, 'Priya')

  await expect(page.getByRole('heading', { name: 'What needs attention' })).toBeVisible()
  await expect(page.getByText('Send the launch press kit to marketing').first()).toBeVisible()
  await page.screenshot({ path: 'test-results/screens/dashboard.png', fullPage: true })

  await page.getByRole('navigation', { name: 'Primary' }).first().getByRole('link', { name: 'Queue' }).click()
  const card = page.locator('[id="d_c_m_18"]')
  await expect(card.getByRole('button', { name: 'Approve (shadow, not sent)' })).toBeDisabled()
  await card.getByRole('checkbox').check()
  await card.getByRole('button', { name: 'Approve (shadow, not sent)' }).click()
  await expect(page.getByText('Approved in shadow mode. Nothing was sent.')).toBeVisible()
  await page.getByRole('tab', { name: /Approved \(1\)/ }).click()
  await expect(page.getByRole('link', { name: 'Share the homepage mockups' })).toBeVisible()
  await page.screenshot({ path: 'test-results/screens/queue.png', fullPage: true })

  await page.goto('/commitments/c_m_03')
  await expect(page.getByText(/rule DONE\+LINK_SIMILARITY/)).toBeVisible()

  await page.goto('/evidence')
  await expect(page.getByText('Not scored', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Audit log' }).click()
  await expect(page.getByText('draft.approve')).toBeVisible()
  await page.screenshot({ path: 'test-results/screens/evidence.png', fullPage: true })

  // Survives a reload (IndexedDB)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Evidence' })).toBeVisible()
  expect(errors).toEqual([])
})

test('member sees only their work and cannot approve', async ({ page }) => {
  const errors = trackErrors(page)
  await loadDemoAs(page, 'Lena')
  await expect(page.getByRole('heading', { name: 'Your work, Lena' })).toBeVisible()
  await page.goto('/team')
  await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible()
  await expect(page.getByText('Assign a task')).toHaveCount(0)
  await page.goto('/commitments/c_m_21')
  await page.getByLabel('Report a blocker').fill('Waiting on the final logo')
  await page.getByRole('button', { name: 'Report blocker' }).click()
  await expect(page.getByText('Saved')).toBeVisible()
  await expect(page.getByText('Waiting on the final logo')).toBeVisible()
  expect(errors).toEqual([])
})

test('works at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await loadDemoAs(page, 'Priya')
  await expect(page.getByRole('heading', { name: 'What needs attention' })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await page.screenshot({ path: 'test-results/screens/dashboard-phone.png', fullPage: true })
  await page.getByRole('link', { name: 'Queue' }).last().click()
  await expect(page.getByRole('heading', { name: 'Draft queue' })).toBeVisible()
})

test('api routes respond in the dev server', async ({ request }) => {
  const health = await request.get('/api/health')
  expect(health.status()).toBe(200)
  expect(await health.json()).toMatchObject({ ok: true })
  const bad = await request.post('/api/process', { data: 'x', headers: { 'content-type': 'text/plain' } })
  expect(bad.status()).toBe(415)
})
