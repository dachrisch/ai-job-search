import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
})
