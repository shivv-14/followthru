import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App'
import demo from '../src/mocks/demoDataset.json'
import { validateDataset } from '../src/schema/validate'
import { db } from '../src/store/db'
import * as repo from '../src/store/repo'

async function seed(profileId: string | null) {
  await db.delete()
  await db.open()
  await repo.loadDataset('setup', 'Synthetic demo data', 'demo', validateDataset(demo))
  if (profileId) await repo.updateSettings('setup', { profileId, userName: 'Tester' })
}

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(() => cleanup())

describe('app with real engine data', () => {
  it('sends a first-time visitor to setup', async () => {
    at('/dashboard')
    expect(await screen.findByRole('heading', { name: 'Set up FollowThru' })).toBeInTheDocument()
  })

  it('asks for a profile once data is loaded', async () => {
    await seed(null)
    at('/dashboard')
    expect(await screen.findByRole('heading', { name: 'Choose a profile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue as Priya' })).toBeInTheDocument()
  })

  it('shows the coordinator dashboard with engine results', async () => {
    await seed('p_priya')
    at('/dashboard')
    expect(await screen.findByRole('heading', { name: 'What needs attention' })).toBeInTheDocument()
    const attention = screen.getByText('Needs your attention').closest('div')!.parentElement!
    expect(within(attention).getByText('Send the launch press kit to marketing')).toBeInTheDocument()
    expect(within(attention).getByText('Send the Q3 budget report to finance')).toBeInTheDocument()
    expect(within(attention).queryByText('Send the revised pricing deck to the client')).not.toBeInTheDocument()
  })

  it('lists and filters commitments from the URL', async () => {
    await seed('p_priya')
    at('/commitments?status=done')
    expect(await screen.findAllByText('Send the revised pricing deck to the client')).not.toHaveLength(0)
    expect(screen.queryAllByText('Send the launch press kit to marketing')).toHaveLength(0)
  })

  it('explains a commitment with its evidence timeline', async () => {
    await seed('p_priya')
    at('/commitments/c_m_03')
    expect(await screen.findByRole('heading', { name: 'Send the revised pricing deck to the client' })).toBeInTheDocument()
    expect(screen.getByText(/rule DONE\+LINK_SIMILARITY/)).toBeInTheDocument()
    expect(screen.getByText(/Closed work is never chased/)).toBeInTheDocument()
  })

  it('blocks approval until the recipient is confirmed, then approves in shadow mode', async () => {
    await seed('p_priya')
    at('/queue')
    const card = (await screen.findByText('Share the homepage mockups')).closest('[id]') as HTMLElement
    const approve = within(card).getByRole('button', { name: 'Approve (shadow, not sent)' })
    expect(approve).toBeDisabled()
    expect(within(card).getByText('• Confirm the recipient before approving')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('checkbox'))
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Approve (shadow, not sent)' })).toBeEnabled(), { timeout: 5000 })
    fireEvent.click(within(card).getByRole('button', { name: 'Approve (shadow, not sent)' }))
    expect(await screen.findByText('Approved in shadow mode. Nothing was sent.', undefined, { timeout: 5000 })).toBeInTheDocument()
    await waitFor(async () => expect((await db.drafts.get('d_c_m_18'))?.state).toBe('approved'))
  }, 15_000)

  it('shows a member only their own work and no approval controls', async () => {
    await seed('p_lena')
    at('/team')
    expect(await screen.findByRole('heading', { name: 'My tasks' })).toBeInTheDocument()
    expect(screen.getByText('Send the launch press kit to marketing')).toBeInTheDocument()
    expect(screen.queryByText('Assign a task')).not.toBeInTheDocument()
  })

  it('reports that demo data is not scored', async () => {
    await seed('p_priya')
    at('/evidence')
    expect(await screen.findByText(/no labelled commitments \(synthetic demo data\)/)).toBeInTheDocument()
    expect(screen.getByText('Not scored')).toBeInTheDocument()
  })
})
