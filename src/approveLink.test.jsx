import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App.jsx'

// ─── The link in the leave email opens the approvals screen ──────────────────

const ERIN = { name: 'Erin Smallbon', email: 'erin@technomed.com.au', token: 't', isAdmin: true }

beforeEach(() => {
  localStorage.setItem('tm_user', JSON.stringify(ERIN))
  localStorage.setItem('tm_login_time', String(Date.now()))
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) })
})

describe('/?go=approvals', () => {
  it('opens the leave approvals screen rather than Cases, and tidies the address', async () => {
    window.history.replaceState(null, '', '/?go=approvals')
    render(<App />)
    expect(await screen.findByText('Leave applications')).toBeInTheDocument()
    expect(window.location.search).toBe('')
  })

  it('opens Cases as usual without it', async () => {
    window.history.replaceState(null, '', '/')
    render(<App />)
    expect(screen.queryByText('Leave applications')).not.toBeInTheDocument()
  })
})
