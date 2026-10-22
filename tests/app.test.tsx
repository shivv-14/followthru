import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App'

afterEach(() => cleanup())

describe('App', () => {
  it('renders the landing page tagline and CTA', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    // "late." and "done." are styled separately, so match the whole heading
    expect(screen.getByRole('heading', { level: 1, name: /Chase what's late\.\s*Never what's done\./ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open app' })).toBeInTheDocument()
  })

  it('renders the style guide route', async () => {
    render(
      <MemoryRouter initialEntries={['/styleguide']}>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Style guide' })).toBeInTheDocument()
  })

  it('falls back to a not found page for unknown routes', () => {
    render(
      <MemoryRouter initialEntries={['/nowhere']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})
