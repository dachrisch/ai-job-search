import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../src/App'

function seedAuth() {
  localStorage.setItem('auth', JSON.stringify({ userId: 'u1', token: 't1' }))
}

describe('App routing', () => {
  beforeEach(() => localStorage.clear())

  it('goes straight to search when authenticated', () => {
    seedAuth()
    render(<App />)
    expect(screen.getByText('Find your next role.')).toBeInTheDocument()
  })

  it('shows the login screen when not authenticated', () => {
    render(<App />)
    expect(screen.getByText(/Sign in/i)).toBeInTheDocument()
  })
})