import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResultsPage } from '../src/pages/ResultsPage'

vi.mock('../src/hooks/useSSE', () => ({
  useSSE: () => ({ status: 'running', iterationCount: 1, jobs: [], isConnected: true, error: null }),
}))
// SearchProgress fetches on mount; stub global fetch so it doesn't error.
beforeEach(() => {
  localStorage.setItem('auth', JSON.stringify({ userId: 'u1', token: 't1', hasClaudeToken: true }))
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'running' }) }) as any
})

describe('ResultsPage', () => {
  it('shows the slim status line', () => {
    render(<ResultsPage searchId="s1" token="t1" onBack={vi.fn()} />)
    expect(screen.getByText(/Finding matches/i)).toBeInTheDocument()
  })

  it('keeps search details collapsed by default', () => {
    const { container } = render(<ResultsPage searchId="s1" token="t1" onBack={vi.fn()} />)
    const details = container.querySelector('details.details-toggle') as HTMLDetailsElement
    expect(details).not.toBeNull()
    expect(details.open).toBe(false)
  })
})
