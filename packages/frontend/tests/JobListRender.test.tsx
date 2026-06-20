import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { JobList } from '../src/components/JobList'

const job = (over: Partial<any> = {}) => ({
  id: '1', title: 'Backend Engineer', company: 'Acme', description: 'x'.repeat(20),
  url: 'http://x', location: 'Remote', matchScore: 90, matchReasoning: 'fit', ...over,
})

describe('JobList (presentational)', () => {
  it('renders a card per job', () => {
    render(<JobList jobs={[job({ id: '1', title: 'Backend Engineer' }), job({ id: '2', title: 'Platform Engineer' })]} isLoading={false} />)
    expect(screen.getByText('Backend Engineer')).toBeInTheDocument()
    expect(screen.getByText('Platform Engineer')).toBeInTheDocument()
  })

  it('shows a discovering message while loading with no jobs', () => {
    render(<JobList jobs={[]} isLoading={true} />)
    expect(screen.getByText(/Discovering/i)).toBeInTheDocument()
  })

  it('shows an empty state when not loading and no jobs', () => {
    render(<JobList jobs={[]} isLoading={false} />)
    expect(screen.getByText(/No jobs found/i)).toBeInTheDocument()
  })
})
