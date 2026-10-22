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
  it('sends a first-time visitor to sign in, which offers to load data', async () => {
    at('/dashboard')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'No data loaded yet' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload a file' })).toBeInTheDocument()
  })

  it('asks who you are once data is loaded, coordinators first', async () => {
    await seed(null)
    at('/dashboard')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /^Sign in as Priya/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Sign in as Amir/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /member/i }))
    expect(await screen.findByRole('button', { name: /^Sign in as Amir/ })).toBeInTheDocument()
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
    const approve = within(card).getByRole('button', { name: 'Approve' })
    expect(approve).toBeDisabled()
    expect(within(card).getByText('• Confirm the recipient before approving')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('checkbox'))
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Approve' })).toBeEnabled(), { timeout: 5000 })
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('Approved in shadow mode. Nothing was sent.', undefined, { timeout: 5000 })).toBeInTheDocument()
    await waitFor(async () => expect((await db.drafts.get('d_c_m_18'))?.state).toBe('approved'))
  }, 15_000)

  it('rejects a draft with a reason and moves it to the Rejected lane', async () => {
    await seed('p_priya')
    at('/queue')
    const card = (await screen.findByText('Share the homepage mockups')).closest('[id]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Reason (kept in the audit log)'), { target: { value: 'Tone is too firm' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject draft' }))
    expect(await screen.findByText('Draft rejected', undefined, { timeout: 5000 })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('tab', { name: /Rejected \(1\)/ }, { timeout: 5000 }))
    expect(await screen.findByText(/Tone is too firm/)).toBeInTheDocument()
  }, 15_000)

  it('shows a member only their own work and no approval controls', async () => {
    await seed('p_lena')
    at('/team')
    expect(await screen.findByRole('heading', { name: 'My tasks' })).toBeInTheDocument()
    expect(screen.getByText('Send the launch press kit to marketing')).toBeInTheDocument()
    expect(screen.queryByText('Assign a task')).not.toBeInTheDocument()
  })

  it('shows members only their navigation and redirects them away from coordinator pages', async () => {
    await seed('p_lena')
    at('/queue')
    expect(await screen.findByText('That page is for coordinators. Here are your tasks instead.')).toBeInTheDocument()
    const nav = screen.getAllByRole('navigation', { name: 'Primary' })[0]
    expect(within(nav).queryByRole('link', { name: /Queue/ })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /Flows/ })).not.toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'My tasks' })).toBeInTheDocument()
  })

  it('shows a coordinator the people grid with local times', async () => {
    await seed('p_priya')
    at('/team')
    expect(await screen.findByRole('heading', { name: 'People' })).toBeInTheDocument()
    expect(screen.getByText('America/Los_Angeles')).toBeInTheDocument()
  })

  it('filters the audit log by action', async () => {
    await seed('p_priya')
    await repo.audit({ actorId: 'p_priya', action: 'draft.approve', entity: 'draft', entityId: 'd_x' })
    at('/evidence')
    fireEvent.click(await screen.findByRole('tab', { name: 'Audit log' }))
    expect(await screen.findByText('data.load')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Action starts with'), { target: { value: 'draft.' } })
    await waitFor(() => expect(screen.queryByText('data.load')).not.toBeInTheDocument())
    expect(screen.getByText('draft.approve')).toBeInTheDocument()
  }, 15_000)

  it('reports that demo data is not scored', async () => {
    await seed('p_priya')
    at('/evidence')
    expect(await screen.findByText(/no labelled commitments \(synthetic demo data\)/)).toBeInTheDocument()
    expect(screen.getByText('Not scored')).toBeInTheDocument()
  })
})
