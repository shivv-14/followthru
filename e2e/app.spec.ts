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
  await page.getByRole('button', { name: 'Use the demo team (synthetic data)' }).click()
  await expect(page.getByText('Ready to load')).toBeVisible()
  await page.getByRole('button', { name: 'Load and continue' }).click()
  await signInAs(page, person)
}

/** Local sign-in page: switch to the member list when the person is not a coordinator. */
async function signInAs(page: Page, person: string) {
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  const button = page.getByRole('button', { name: new RegExp(`^Sign in as ${person}`) })
  if (!(await button.isVisible())) await page.getByRole('radio', { name: /member/i }).click()
  await button.click()
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
  await expect(card.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled()
  await card.getByRole('checkbox').click()
  await expect(card.getByRole('checkbox')).toBeChecked()
  await card.getByRole('button', { name: 'Approve', exact: true }).click()
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

test('coordinator edits then rejects a draft', async ({ page }) => {
  const errors = trackErrors(page)
  await loadDemoAs(page, 'Priya')
  await page.goto('/queue')
  const card = page.locator('[id="d_c_m_21"]')
  await card.getByRole('button', { name: 'Edit' }).click()
  await card.getByLabel('Draft text').fill('Hi Lena, could you send the press kit today?')
  await card.getByRole('button', { name: 'Save text' }).click()
  await expect(card.getByText('Hi Lena, could you send the press kit today?')).toBeVisible()
  await page.reload()
  await expect(page.locator('[id="d_c_m_21"]').getByText('Edited by Priya Sharma')).toBeVisible()
  await page.locator('[id="d_c_m_21"]').getByRole('button', { name: 'Reject' }).click()
  await page.getByLabel('Reason (kept in the audit log)').fill('Client asked us to wait')
  await page.getByRole('button', { name: 'Reject draft' }).click()
  await page.getByRole('tab', { name: /Rejected \(1\)/ }).click()
  await expect(page.getByText(/Client asked us to wait/)).toBeVisible()
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

test('member asks for more time, coordinator approves it', async ({ page }) => {
  const errors = trackErrors(page)
  await loadDemoAs(page, 'Lena')
  await page.goto('/queue')
  await expect(page.getByText('That page is for coordinators. Here are your tasks instead.')).toBeVisible()
  await page.goto('/commitments/c_m_21')
  await page.getByLabel('Need more time? New date (your time)').fill('2026-10-23T12:00')
  await page.getByLabel('Why do you need more time?').fill('Waiting on the final logo')
  await page.getByRole('button', { name: 'Ask for more time' }).click()
  await expect(page.getByText(/More time requested by Lena Ortiz/)).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await signInAs(page, 'Priya')
  await expect(page).toHaveURL(/\/commitments\/c_m_21$/)
  await expect(page.getByRole('button', { name: 'Approve new date' })).toBeVisible()
  await page.getByRole('button', { name: 'Approve new date' }).click()
  await expect(page.getByText(/More time approved by Lena Ortiz/)).toBeVisible()
  await page.goto('/queue')
  await page.getByRole('tab', { name: /Suppressed/ }).click()
  const card = page.locator('[id="d_c_m_21"]')
  // v2: Lena's request counts as a reply; v3: the approved new date
  await expect(card.getByText(/version 3/)).toBeVisible()
  expect(errors).toEqual([])
})

test('commitment detail explains itself, replays history and shows the thread', async ({ page }) => {
  const errors = trackErrors(page)
  await loadDemoAs(page, 'Priya')
  await page.goto('/commitments/c_m_03')
  await expect(page.getByTestId('plain-why')).toContainText('no reminder will ever be drafted')
  const slider = page.getByRole('slider')
  await slider.focus()
  await page.keyboard.press('Home')
  await expect(page.getByTestId('replay-frame')).toContainText('Open')
  await page.keyboard.press('End')
  await expect(page.getByTestId('replay-frame')).toContainText('Done')
  await page.getByRole('button', { name: /View thread/ }).click()
  await expect(page.getByRole('dialog').getByText('used as evidence').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('optional AI second opinion flags a disagreement and falls back honestly', async ({ page }) => {
  // The Gemini endpoint is mocked: no real key or network call is used in this check
  let calls = 0
  let refuse = false
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    calls++
    expect(route.request().url()).not.toContain('test-key')
    expect(route.request().headers()['x-goog-api-key']).toBe('test-key')
    if (refuse) return route.fulfill({ status: 403, body: '{}' })
    const text = JSON.stringify({ signals: [{ messageId: 'm_18', kind: 'completion', confidence: 0.92 }] })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) })
  })
  await loadDemoAs(page, 'Priya')
  await page.goto('/evidence')
  await page.getByRole('tab', { name: 'Data & settings' }).click()
  await page.getByLabel(/AI second opinion/).click()
  await expect(page.getByLabel(/AI second opinion/)).toBeChecked()
  await expect(page.getByText(/Rules \(fallback\): No API key saved/)).toBeVisible()
  await page.getByLabel('Gemini API key').fill('test-key')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/AI assisted: .* read 1 messages/)).toBeVisible()
  expect(calls).toBeGreaterThan(0)

  await page.goto('/commitments/c_m_18')
  await expect(page.getByText('The AI read a message differently from the rules').first()).toBeVisible()

  refuse = true
  await page.goto('/evidence')
  await page.getByRole('tab', { name: 'Data & settings' }).click()
  await page.getByRole('button', { name: 'Clear' }).click()
  await page.getByLabel('Gemini API key').fill('test-key')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/Rules \(fallback\): The AI service refused the request \(HTTP 403\)/)).toBeVisible()
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
  const evidence = await request.get('/api/evidence?format=csv&kind=drafts')
  expect(evidence.status()).toBe(200)
  expect(evidence.headers()['x-followthru-dataset']).toBe('synthetic-demo')
  expect(await evidence.text()).toContain('commitmentId')
})
