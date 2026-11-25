import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import WhosWhere from './WhosWhere.jsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const D = '2026-11-25'
const days = [{ date: D, casesByHospital: [{ hospital: 'Calvary Lenah Valley', cases: [{ patient: 'Davis', surgeon: 'JPW', planned: ['Ben'] }] }] },
  { date: '2026-11-26', casesByHospital: [] }]

describe("who's where strip", () => {
  it('draws everyone with a status ring, Ben in theatre from his planned case', () => {
    render(<WhosWhere date={D} days={days} away={[{ email: 'mat@technomed.com.au', days: [D], why: { [D]: 'Leave' } }]} entries={[]} />)
    expect(document.querySelector('[data-whos-where-person="Ben"]').dataset.status).toBe('theatre')
    expect(document.querySelector('[data-whos-where-person="Mat"]').dataset.status).toBe('leave')
    expect(document.querySelector('[data-whos-where-person="Erin"]').dataset.status).toBe('office')
    expect(document.querySelector('[data-whos-where-add]')).toBeTruthy()
  })

  it('opens a person, the whole team by status, and the next day', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ entries: [] }) })))
    render(<WhosWhere date={D} days={days} away={[]} entries={[]} />)
    fireEvent.click(document.querySelector('[data-whos-where-person="Ben"]'))
    expect(document.querySelector('[data-whos-where-card]').textContent).toMatch(/Calvary/)
    fireEvent.click(document.querySelector('[data-whos-where-card]').querySelector('button:last-child'))
    fireEvent.click(document.querySelector('[data-whos-where-team]'))
    expect(document.querySelector('[data-whos-where-group="theatre"]')).toBeTruthy()
    expect(document.querySelector('[data-whos-where-group="none"]')).toBeTruthy()
    fireEvent.click(document.querySelector('[aria-label="Day after"]'))
    expect(document.querySelector('[data-whos-where-day]').textContent).toMatch(/26 November/)
  })

  it('a person with no entry opens Add status for them', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ entries: [] }) })))
    render(<WhosWhere date={D} days={days} away={[]} entries={[]} />)
    fireEvent.click(document.querySelector('[data-whos-where-person="Aimee"]'))
    expect(document.querySelector('[data-status-sheet]')).toBeTruthy()
  })
})
