import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { JobCard } from '../src/components/JobCard'

const base = {
  id: '1', title: 'Backend Engineer', company: 'Acme', description: 'x'.repeat(50),
  url: 'https://example.com', location: 'Remote', matchReasoning: 'good fit',
}

describe('JobCard', () => {
  it('uses the ok score style for scores >= 80', () => {
    const { container } = render(<JobCard job={{ ...base, matchScore: 92 }} />)
    expect(container.querySelector('.score-ok')).not.toBeNull()
    expect(container.querySelector('.score-warn')).toBeNull()
  })

  it('uses the warn score style for scores < 80', () => {
    const { container } = render(<JobCard job={{ ...base, matchScore: 64 }} />)
    expect(container.querySelector('.score-warn')).not.toBeNull()
    expect(container.querySelector('.score-ok')).toBeNull()
  })
})
