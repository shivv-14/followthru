import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../src/App'

describe('App', () => {
  it('renders the tagline', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'FollowThru' })).toBeInTheDocument()
    expect(screen.getByText("Chase what's late. Never what's done.")).toBeInTheDocument()
  })
})
