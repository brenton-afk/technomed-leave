import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { readFileSync } from 'fs'
import { join } from 'path'
import CaseWeek from '../CaseWeek.jsx'

// ─── What a booking says, in the order it says it ────────────────────────────
// "It would also be good if the order of the information was different:
// patient/surgeon, then the operation description, then the system and
// loan/consignment, then the information about where it is on the list, then
// entered by Brent and the rep who attended at the bottom once that's added."
//
// Checked against the rendered text rather than the source, because the order
// of blocks in a file and the order on a card are not the same thing — a block
// can be moved and still come out where it was.

const USER = { token: 't', firstName: 'Brent', email: 'brenton@technomed.com.au' }

const BOOKING = {
  id: 'c1',
  // The rep goes in the title's parentheses — "Vellacott REFORM - Atallah
  // (Aimee)" is the team's own convention and what extractRep reads.
  summary: 'Whiteley CYLOX - Thani (Aimee)',
  description: 'Surgeon: Thani\nPatient: Whiteley\nHospital: CLV\n'
    + 'Procedure: C5/6 ACDF decompression\nKit: CYLOX (Distributor Loan)\n'
    + 'List: 2nd · morning\n\nEntered by Brent',
  location: 'Calvary',
  start: { dateTime: '2026-10-12T09:00:00+11:00' },
  end: { dateTime: '2026-10-12T10:00:00+11:00' }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-10-12T02:00:00.000Z'))
  localStorage.clear()
  window.matchMedia = q => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}
  })
  global.fetch = vi.fn(async () => ({
    ok: true, json: async () => ({ events: [BOOKING], syncedAt: '2026-10-12T02:00:00.000Z' })
  }))
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const card = async () => {
  render(<CaseWeek user={USER} />)
  await waitFor(() => expect(screen.getByText('Whiteley')).toBeInTheDocument())
  return screen.getByText('Whiteley').closest('button')
}

describe('the order of a booking card', () => {
  it('runs patient, operation, system, list place, then the rep', async () => {
    const text = (await card()).textContent
    const at = what => text.indexOf(what)

    expect(at('Whiteley')).toBeGreaterThanOrEqual(0)
    expect(at('Whiteley')).toBeLessThan(at('ACDF'))
    expect(at('ACDF')).toBeLessThan(at('CYLOX'))
    expect(at('CYLOX')).toBeLessThan(at('on the list'))
    // "Rep:", not the name — the attribution note reads "Entered by Brent
    // (Aimee)", so looking for the name alone finds that instead and the
    // assertion passes with the rep anywhere on the card.
    expect(at('on the list')).toBeLessThan(at('Rep:'))
  })

  it('puts the rep last of all', async () => {
    const text = (await card()).textContent
    // "the rep who attended at the bottom once that's added". Below the
    // attribution, which is the last of the notes.
    expect(text.indexOf('Rep:')).toBeGreaterThan(text.indexOf('Entered by'))
  })

  it('keeps the surgeon beside the patient, not somewhere else', async () => {
    const text = (await card()).textContent
    expect(text.indexOf('Thani') - text.indexOf('Whiteley')).toBeLessThan(20)
  })
})

describe('which half of the kit line is bold', () => {
  it('bolds the system, not the loan word', async () => {
    // "The name of the system should be what is in bold, rather than the
    // Loan/Consignment word." The system is what somebody is looking for when
    // they scan a card; where it comes from is the next question.
    await card()
    const system = screen.getByText('CYLOX')
    expect(system.style.fontWeight).toBe('700')

    const supply = screen.getByText(/\(Distributor Loan\)/)
    expect(supply.style.fontWeight).toBe('400')
  })

  it('does the same on the desktop column', () => {
    // One rule, both views. The week column shortens the words and must not
    // shout a different half of them. jsdom renders one view at a time, so
    // this reads the other one's source — bounded to the kit line.
    const source = readFileSync(join(__dirname, '..', 'CaseWeek.jsx'), 'utf8')
    const week = source.slice(source.indexOf('function WeekCase'))
    const line = week.slice(week.indexOf('{entry.system}'), week.indexOf('supply?'))
    expect(line).toMatch(/<strong style=\{\{ fontWeight: 700 \}\}>\{entry\.system\}/)
    expect(line).toMatch(/fontWeight: 400/)
  })
})
