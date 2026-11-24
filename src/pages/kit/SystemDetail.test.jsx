import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import SystemDetail from './SystemDetail.jsx'

// Brent, 21 Nov 2026: "The Calvary set is too small … If there's a loan set at
// Calvary that needs to be really clear … a consignment section and a loan
// section to illustrate when a loan kit is on site." Invented kits.
beforeEach(() => { globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ list: null }) })) })

describe('a system with a loan set on site', () => {
  it('shows Calvary’s own set under Consignment and the TM loan set under On loan here, each with its own header', () => {
    const system = { name: 'Dakota', kits: [
      { id: 'dak-clv', name: 'Dakota 1', system: 'Dakota', home: 'CLV', at: 'CLV', kind: 'consignment', trays: ['Dakota Instruments'] },
      { id: 'dak-loan', name: 'Dakota (TM loan)', system: 'Dakota', home: 'office', at: 'CLV', kind: 'floating', trays: ['Dakota Loan Tray'], away: { since: '2026-11-20T00:00:00Z', surname: 'Testcase', surgeon: 'Gupta', caseDate: '2026-11-24' } }
    ] }
    render(<SystemDetail system={system} distributor="E4 Surgical" canEdit user={{ token: 't' }} post={vi.fn()} onClose={() => {}} />)
    const own = document.querySelector('[data-set-group="own"]')
    const loan = document.querySelector('[data-set-group="loan"]')
    expect(own).toHaveTextContent('Consignment')
    expect(own.querySelector('[data-system-set="dak-clv"]')).toBeTruthy()
    expect(own).toHaveTextContent('Calvary set')
    expect(own).toHaveTextContent('Consigned to Calvary')
    expect(loan).toHaveTextContent('On loan here')
    expect(loan.querySelector('[data-system-set="dak-loan"]')).toBeTruthy()
    expect(loan).toHaveTextContent('TechnoMed loan set, on loan to Calvary')
    expect(loan.querySelector('[data-set-kind]')).toHaveTextContent('LOAN')
    // The case the move was for (Brent, 21 Nov 2026: "it's there for pt …").
    expect(loan.querySelector('[data-set-case]')).toHaveTextContent('For pt Testcase · Gupta · Tue 24 Nov')
    expect(screen.getByRole('button', { name: 'Move all of the TM loan set' })).toHaveTextContent('Send it back')
  })
  it('a hospital with only its own sets has no loan section', () => {
    const system = { name: 'Diplomat', kits: [{ id: 'd1', name: 'Diplomat 1', system: 'Diplomat', home: 'RHH', at: 'RHH', kind: 'consignment', trays: [] }] }
    render(<SystemDetail system={system} canEdit user={{ token: 't' }} post={vi.fn()} onClose={() => {}} />)
    expect(document.querySelector('[data-set-group="loan"]')).toBeNull()
    expect(document.querySelector('[data-set-group="own"]')).toHaveTextContent('Consigned to RHH')
  })
})

describe('finding a tray inside a system', () => {
  it('shows only the sets and trays that match every word, at any place', async () => {
    const { fireEvent } = await import('@testing-library/react')
    const system = { name: 'Diplomat', kits: [
      { id: 'd-rhh', name: 'Diplomat 2', system: 'Diplomat', home: 'RHH', at: 'RHH', kind: 'consignment', trays: ['Diplomat Torque & Reduction', 'Diplomat Rods'] },
      { id: 'd-clv', name: 'Diplomat 1', system: 'Diplomat', home: 'CLV', at: 'CLV', kind: 'consignment', trays: ['Diplomat Rods'] }
    ] }
    render(<SystemDetail system={system} canEdit user={{ token: 't' }} post={vi.fn()} onClose={() => {}} place="CLV" onSayMove={() => {}} />)
    expect(document.querySelector('[data-system-set="d-rhh"]')).toBeNull()
    fireEvent.change(screen.getByLabelText('Find a tray'), { target: { value: 'torque' } })
    expect(document.querySelector('[data-system-set="d-rhh"]')).toBeTruthy()
    expect(document.querySelector('[data-system-set="d-clv"]')).toBeNull()
    fireEvent.change(screen.getByLabelText('Find a tray'), { target: { value: 'rods calvary' } })
    expect(document.querySelector('[data-system-set="d-clv"]')).toBeTruthy()
    expect(document.querySelector('[data-system-set="d-rhh"]')).toBeNull()
    fireEvent.change(screen.getByLabelText('Find a tray'), { target: { value: 'cage' } })
    expect(document.querySelector('[data-find-none]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Say a move' })).toBeTruthy()
  })
})
