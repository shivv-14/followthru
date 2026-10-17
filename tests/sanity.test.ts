import { describe, expect, it } from 'vitest'

describe('sanity', () => {
  it('runs in node', () => {
    expect(typeof window).toBe('undefined')
    expect(1 + 1).toBe(2)
  })
})
