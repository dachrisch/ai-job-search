import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusLine } from '../src/components/StatusLine'

describe('StatusLine', () => {
  it('shows live count while running', () => {
    render(<StatusLine status="running" jobsFound={12} onRetry={vi.fn()} />)
    expect(screen.getByText(/Finding matches/i)).toBeInTheDocument()
    expect(screen.getByText(/12/)).toBeInTheDocument()
  })

  it('shows a quiet result count when complete', () => {
    render(<StatusLine status="complete" jobsFound={24} onRetry={vi.fn()} />)
    expect(screen.getByText(/24 results/i)).toBeInTheDocument()
  })

  it('shows a retry affordance when failed', () => {
    const onRetry = vi.fn()
    render(<StatusLine status="failed" jobsFound={0} onRetry={onRetry} />)
    expect(screen.getByText(/Retry/i)).toBeInTheDocument()
  })
})
