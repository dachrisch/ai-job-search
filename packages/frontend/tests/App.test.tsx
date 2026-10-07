import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../src/hooks/AuthContext'
import App from '../src/App'

function seedAuth() {
  localStorage.setItem('auth', JSON.stringify({ userId: 'u1', token: 't1' }))
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>
  )
}

describe('App routing', () => {
  beforeEach(() => localStorage.clear())

  it('goes straight to search when authenticated', () => {
    seedAuth()
    renderApp()
    expect(screen.getByText('Find your next role.')).toBeInTheDocument()
  })

  it('shows the login screen when not authenticated', () => {
    renderApp()
    expect(screen.getByText(/Sign in/i)).toBeInTheDocument()
  })
})