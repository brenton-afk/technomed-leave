import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'
import { readFileSync } from 'fs'
import { join } from 'path'
import UsageScan from './UsageScan.jsx'

// ─── The scan that froze ─────────────────────────────────────────────────────
// "There's a bug in the scanner. I scanned a page the other day and it scanned
// well then it froze with no buttons to proceed/cancel etc."
//
// The review screen draws only when there is a case to review —
// `step === 'review' && caseRecord` — and processScan moved to that step on any
// reply that merely lacked an error. A reply with no case in it left the app on
// a screen that rendered nothing: no heading, no buttons, no way back, with the
// scan still in hand and a signed form in the other.
//
// Two fixes, because the second is the one that matters. A reply without a case
// is a failed read, whatever the status code said — and a screen that *can*
// render nothing is one unforeseen state away from doing this again.

const USER = { name: 'Brenton Lovering', email: 'brenton@technomed.com.au', token: 'tok' }

const phone = () => {
  window.matchMedia = q => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}
  })
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
}

beforeEach(() => { phone() })
afterEach(() => vi.restoreAllMocks())

describe('a reply with no case in it', () => {
  it('is treated as a failed read, not a successful one', () => {
    // Checked in the source: driving the camera in jsdom is not possible, and
    // the fault is one branch — the step moved on without the thing the next
    // screen needs.
    const source = readFileSync(join(__dirname, 'UsageScan.jsx'), 'utf8')
    const scan = source.slice(source.indexOf('async function processScan'))
    const body = scan.slice(0, scan.indexOf('\n  }'))

    // The guard, and that it comes before the step changes.
    expect(body).toMatch(/if \(!data\.case\)/)
    expect(body.indexOf('!data.case')).toBeLessThan(body.indexOf("setStep('review')"))
  })

  it('says what to do about it, rather than only that it failed', () => {
    const source = readFileSync(join(__dirname, 'UsageScan.jsx'), 'utf8')
    expect(source).toMatch(/came back empty/)
    expect(source).toMatch(/more light, and the whole sheet in frame/)
  })
})

describe('no state renders nothing', () => {
  it('has no bare `return null` left at the end', () => {
    // That was the shape of the freeze: every guarded branch declined to draw
    // and the component rendered nothing at all.
    const source = readFileSync(join(__dirname, 'UsageScan.jsx'), 'utf8')
    const tail = source.slice(source.lastIndexOf("if (step === 'done'"))
    expect(tail).not.toMatch(/\n {2}return null\n\}/)
  })

  it('always leaves a way out', () => {
    const source = readFileSync(join(__dirname, 'UsageScan.jsx'), 'utf8')
    const tail = source.slice(source.lastIndexOf("if (step === 'done'"))
    expect(tail).toMatch(/Something went wrong reading that/)
    expect(tail).toMatch(/Start again/)
  })

  it('keeps the photographs, so starting again is not photographing again', () => {
    const source = readFileSync(join(__dirname, 'UsageScan.jsx'), 'utf8')
    const tail = source.slice(source.lastIndexOf("if (step === 'done'"))
    expect(tail).toMatch(/setStep\(pages\.length \? 'capture' : 'history'\)/)
  })
})

describe('the screens that do draw still draw', () => {
  it('opens on the camera step on a phone', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ records: [] }) }))
    render(<UsageScan user={USER} />)
    // Whatever it shows, it is not nothing — which is the whole complaint.
    await waitFor(() => expect(document.body.textContent.trim().length).toBeGreaterThan(0))
  })
})
