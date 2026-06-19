import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../src/App'

function seedAuth(hasClaudeToken: boolean) {
  localStorage.setItem('auth', JSON.stringify({ userId: 'u1', token: 't1', hasClaudeToken }))
}

describe('App routing', () => {
  beforeEach(() => localStorage.clear())

  it('goes straight to search when the Claude token already exists', () => {
    seedAuth(true)
    render(<App />)
    expect(screen.getByText('Find your next role.')).toBeInTheDocument()
    expect(screen.queryByText(/Claude API/i)).not.toBeInTheDocument()
  })

  it('shows the token setup screen when the token is missing', () => {
    seedAuth(false)
    render(<App />)
    expect(screen.getByText(/Connect your Claude API key/i)).toBeInTheDocument()
  })
})
