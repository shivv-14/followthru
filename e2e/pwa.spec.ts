import { expect, test } from '@playwright/test'

test('manifest has the fields PWABuilder needs and every icon loads', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest')
  expect(res.status()).toBe(200)
  const m = await res.json()
  expect(m).toMatchObject({ name: 'FollowThru - Chaser Draft Queue', short_name: 'FollowThru', start_url: '/dashboard', scope: '/', display: 'standalone', theme_color: '#000000' })
  expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true)
  expect(m.shortcuts.map((s: { url: string }) => s.url)).toEqual(['/queue', '/dashboard', '/team'])
  expect(m.screenshots.map((s: { form_factor: string }) => s.form_factor)).toEqual(['wide', 'narrow'])
  for (const src of [...m.icons.map((i: { src: string }) => i.src), ...m.screenshots.map((s: { src: string }) => s.src), 'apple-touch-icon-180x180.png']) {
    expect((await request.get(`/${src}`)).status(), src).toBe(200)
  }
})

test('registers a service worker and reopens the app offline with local data', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/setup')
  await page.getByLabel('Your name').fill('Offline check')
  await page.getByRole('button', { name: 'Use the demo team (synthetic data)' }).click()
  await page.getByRole('button', { name: 'Load and continue' }).click()
  await page.getByRole('button', { name: /^Sign in as Priya/ }).click()
  await expect(page.getByRole('heading', { name: 'What needs attention' })).toBeVisible()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  // Reload once so the page is controlled by the service worker, then go offline
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  await context.setOffline(true)
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'What needs attention' })).toBeVisible()
  await expect(page.getByText('You are offline. FollowThru keeps working with the data on this device.')).toBeVisible()
  await context.setOffline(false)
  expect(errors).toEqual([])
})
