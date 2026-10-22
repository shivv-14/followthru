import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RouteErrorBoundary } from '../src/components/RouteErrorBoundary'
import { EngineProvider } from '../src/store'

afterEach(() => cleanup())

function Boom(): never {
  throw new Error('page exploded')
}

describe('RouteErrorBoundary', () => {
  it('shows a recovery screen with Reload and Reset instead of a blank page', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <MemoryRouter>
        <EngineProvider>
          <RouteErrorBoundary>
            <Boom />
          </RouteErrorBoundary>
        </EngineProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Something went wrong on this page' })).toBeInTheDocument()
    expect(screen.getByText('page exploded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset local data' })).toBeInTheDocument()
    quiet.mockRestore()
  })
})
