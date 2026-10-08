import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ResultsPage } from '../src/pages/ResultsPage'

const sseState: any = {
  status: 'running',
  jobs: [],
  isConnected: true,
  error: null,
}

const apiState: any = {
  search: { query: 'PM Munich', status: 'running' },
  jobs: { jobs: [] },
}

vi.mock('../src/hooks/useSSE', () => ({
  useSSE: () => sseState,
}))
vi.mock('../src/hooks/useApi', () => ({
  useApi: () => ({
    getSearch: async () => apiState.search,
    getJobs: async () => apiState.jobs,
  }),
}))

function renderAt(searchId = 's1') {
  return render(
    <MemoryRouter initialEntries={[`/search/${searchId}`]}>
      <Routes>
        <Route path="/search/:id" element={<ResultsPage token="t1" />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ResultsPage', () => {
  beforeEach(() => {
    sseState.status = 'running'
    sseState.jobs = []
    sseState.isConnected = true
    sseState.error = null
    apiState.search = { query: 'PM Munich', status: 'running' }
    apiState.jobs = { jobs: [] }
  })

  it('shows the slim status line while running', async () => {
    renderAt()
    expect(await screen.findByText(/Finding matches/i)).toBeInTheDocument()
  })

  it('shows a single failure state when the search failed with no jobs (issue #187)', async () => {
    sseState.status = 'failed'
    apiState.search = { query: 'PM Munich', status: 'failed' }
    renderAt()
    expect(await screen.findByText(/Search failed/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/Finding matches/i)).not.toBeInTheDocument())
    expect(screen.queryByText(/No jobs found yet/i)).not.toBeInTheDocument()
  })

  it('still shows partial jobs when the search failed', async () => {
    const job = {
      id: '1', title: 'Product Manager', company: 'Acme', description: 'desc',
      url: 'http://x', location: 'Munich', matchScore: 80, matchReasoning: 'fit',
    }
    sseState.status = 'failed'
    sseState.jobs = [job]
    apiState.search = { query: 'PM Munich', status: 'failed' }
    apiState.jobs = { jobs: [job] }
    renderAt()
    expect(await screen.findByText(/Search failed/i)).toBeInTheDocument()
    expect(await screen.findByText('Product Manager')).toBeInTheDocument()
  })

  it('collapses jobs scored below 50 behind a toggle (issue #187)', async () => {
    const jobs = [
      { id: '1', title: 'Top PM Job', company: 'Acme', description: 'd', url: 'http://x/1', location: 'Munich', matchScore: 80, matchReasoning: 'fit' },
      { id: '2', title: 'Mediocre Job', company: 'Acme', description: 'd', url: 'http://x/2', location: 'Munich', matchScore: 40, matchReasoning: 'meh' },
      { id: '3', title: 'Poor Job', company: 'Acme', description: 'd', url: 'http://x/3', location: 'Munich', matchScore: 10, matchReasoning: 'no' },
    ]
    sseState.jobs = jobs
    apiState.jobs = { jobs }
    renderAt()
    expect(await screen.findByText('Top PM Job')).toBeInTheDocument()
    expect(screen.queryByText('Mediocre Job')).not.toBeInTheDocument()
    expect(screen.queryByText('Poor Job')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /lower matches/i }))
    expect(await screen.findByText('Mediocre Job')).toBeInTheDocument()
    expect(screen.getByText('Poor Job')).toBeInTheDocument()
  })

  it('always shows unscored jobs even below the threshold', async () => {
    const jobs = [
      { id: '1', title: 'Fresh Unscored Job', company: 'Acme', description: 'd', url: 'http://x/1', location: 'Munich', matchScore: 0, matchReasoning: '' },
    ]
    sseState.jobs = jobs
    apiState.jobs = { jobs }
    renderAt()
    expect(await screen.findByText('Fresh Unscored Job')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /lower matches/i })).not.toBeInTheDocument()
  })
})
