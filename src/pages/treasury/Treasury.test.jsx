import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MeHub } from '../Hubs.jsx'
import Treasury from './Treasury.jsx'

// ─── The Treasury, as other staff see it: not at all ─────────────────────────

const ERIN = { name: 'Erin', email: 'erin@technomed.com.au', token: 't', isAdmin: true, staff: { role: 'General Manager' } }

afterEach(() => vi.unstubAllGlobals())

describe('the card', () => {
  it('is not on the Me hub unless the server has said yes', () => {
    render(<MeHub user={ERIN} onNavigate={() => {}} onLogout={() => {}} />)
    expect(screen.queryByText('Treasury')).toBeNull()
  })

  it('appears when it has', () => {
    render(<MeHub user={ERIN} onNavigate={() => {}} onLogout={() => {}} treasury />)
    expect(screen.getByText('Treasury')).toBeInTheDocument()
  })

  it('appears for someone on the list who is not an admin, too', () => {
    render(<MeHub user={{ ...ERIN, isAdmin: false }} onNavigate={() => {}} onLogout={() => {}} treasury />)
    expect(screen.getByText('Treasury')).toBeInTheDocument()
    expect(screen.queryByText('Admin portal')).toBeNull()
  })
})

describe('landing on it anyway', () => {
  it('shows nothing but a way back when the server answers 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })))
    render(<Treasury user={ERIN} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText('Not available')).toBeInTheDocument())
    expect(screen.queryByText(/Cash at bank/)).toBeNull()
  })
})

describe('the code', () => {
  it('is not in the list of screens prefetched onto every signed-in phone', () => {
    const lazy = readFileSync(join(__dirname, '..', '..', 'lazyScreens.jsx'), 'utf8')
    expect(lazy).not.toMatch(/treasury/i)
  })
})
