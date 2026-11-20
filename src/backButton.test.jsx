import { describe, it, expect, beforeEach } from 'vitest'
import React, { useState } from 'react'
import { render, act, fireEvent } from '@testing-library/react'
import { startBackButton, pushPage, backTo, useBackLayer, resetBackButton, sameNav } from './backButton.js'

// The phone's back button walks back through the portal (Brent, 18 Nov 2026:
// "it exits the entire app").

const settle = () => act(() => new Promise(r => setTimeout(r, 30)))
const back = async () => { window.history.back(); await settle() }

beforeEach(() => {
  resetBackButton()
  window.history.replaceState(null, '')
})

describe('pages', () => {
  it('back returns to the page before, not out of the app', async () => {
    const pages = []
    startBackButton({ tab: 'cases', sub: null }, p => pages.push(p))
    pushPage({ tab: 'me', sub: null })
    pushPage({ tab: 'me', sub: 'messages' })
    await back()
    expect(pages.at(-1)).toMatchObject({ tab: 'me', sub: null })
    await back()
    expect(pages.at(-1)).toMatchObject({ tab: 'cases', sub: null })
  })

  it('a link that lands deep gets the home page underneath', async () => {
    const pages = []
    startBackButton({ tab: 'admin', sub: 'leave' }, p => pages.push(p))
    await back()
    expect(pages.at(-1)).toMatchObject({ tab: 'cases', sub: null })
  })

  it('tapping the page already shown adds no step', () => {
    startBackButton({ tab: 'cases', sub: null }, () => {})
    const before = window.history.length
    pushPage({ tab: 'cases', sub: null })
    expect(window.history.length).toBe(before)
  })

  it('the on-screen back arrow to the hub is the same step as the phone back', async () => {
    const pages = []
    startBackButton({ tab: 'kit', sub: null }, p => pages.push(p))
    pushPage({ tab: 'kit', sub: 'kitroom' })
    expect(backTo({ tab: 'kit', sub: null })).toBe(true)
    await settle()
    expect(pages.at(-1)).toMatchObject({ tab: 'kit', sub: null })
  })

  it('the back arrow from a page reached another way replaces the step', () => {
    startBackButton({ tab: 'cases', sub: null }, () => {})
    pushPage({ tab: 'kit', sub: 'kitroom' })
    expect(backTo({ tab: 'kit', sub: null })).toBe(false)
    expect(window.history.state.tmNav).toMatchObject({ tab: 'kit', sub: null })
  })

  it('compares pages by their plain values', () => {
    expect(sameNav({ tab: 'me', sub: null }, { tab: 'me' })).toBe(true)
    expect(sameNav({ tab: 'kit', sub: 'kitroom', kit: 'a' }, { tab: 'kit', sub: 'kitroom' })).toBe(false)
  })
})

function Sheet({ onClose }) {
  useBackLayer(true, onClose)
  return <div data-sheet>sheet <button onClick={onClose}>Close</button></div>
}

function Screen() {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && <Sheet onClose={() => setOpen(false)} />}
    </div>
  )
}

describe('sheets and viewers', () => {
  it('back closes what is open on top before leaving the page', async () => {
    const pages = []
    startBackButton({ tab: 'cases', sub: null }, p => pages.push(p))
    pushPage({ tab: 'kit', sub: 'kitroom' })
    const { getByText, container } = render(<Screen />)
    fireEvent.click(getByText('Open'))
    expect(container.querySelector('[data-sheet]')).not.toBeNull()
    await back()
    expect(container.querySelector('[data-sheet]')).toBeNull()
    expect(pages).toHaveLength(0)
    await back()
    expect(pages.at(-1)).toMatchObject({ tab: 'cases', sub: null })
  })

  it('closing it by its own button takes its step back off', async () => {
    const pages = []
    startBackButton({ tab: 'cases', sub: null }, p => pages.push(p))
    pushPage({ tab: 'kit', sub: 'kitroom' })
    const { getByText } = render(<Screen />)
    fireEvent.click(getByText('Open'))
    const seqOpen = window.history.state.tmSeq
    fireEvent.click(getByText('Close'))
    await settle()
    expect(window.history.state.tmSeq).toBe(seqOpen - 1)
    await back()
    expect(pages.at(-1)).toMatchObject({ tab: 'cases', sub: null })
  })

  it('a sheet that opened another page is skipped on the way back', async () => {
    const pages = []
    startBackButton({ tab: 'cases', sub: null }, p => pages.push(p))
    const { getByText, unmount } = render(<Screen />)
    fireEvent.click(getByText('Open'))
    pushPage({ tab: 'me', sub: null })
    unmount()
    await back()
    expect(pages.at(-1)).toMatchObject({ tab: 'cases', sub: null })
  })
})

// Brent, 20 Nov 2026: Move in a kit "nothing happens". A real browser's
// queued back() pops a layer opened after it; jsdom's pushState cancels it, so
// these check the logic that avoids it, and `npm run check:back` runs the race
// itself in Chromium.
function Swap() {
  const [which, setWhich] = useState('A')
  return (
    <div>
      {which === 'A' && <Named name="A" onClose={() => setWhich(null)} onSwap={() => setWhich('B')} />}
      {which === 'B' && <Named name="B" onClose={() => setWhich(null)} />}
    </div>
  )
}
function Named({ name, onClose, onSwap }) {
  useBackLayer(true, onClose)
  return <div data-named={name}>{onSwap && <button onClick={onSwap}>Swap</button>}<button onClick={onClose}>Close {name}</button></div>
}

describe('closing one overlay and opening another in the same tap', () => {
  it('the new one takes the closed one\'s step and calls no back()', async () => {
    const pages = []
    startBackButton({ tab: 'cases', sub: null }, p => pages.push(p))
    pushPage({ tab: 'kit', sub: 'kitroom' })
    const { getByText, container } = render(<Swap />)
    const seqA = window.history.state.tmSeq
    const length = window.history.length
    const realBack = window.history.back
    let backs = 0
    window.history.back = () => { backs += 1; realBack.call(window.history) }
    try {
      fireEvent.click(getByText('Swap'))
      await settle()
      expect(backs).toBe(0)
    } finally { window.history.back = realBack }
    expect(container.querySelector('[data-named="B"]')).not.toBeNull()
    expect(window.history.state).toMatchObject({ tmSeq: seqA, tmLayer: true })
    expect(window.history.length).toBe(length)
    await back()
    expect(container.querySelector('[data-named]')).toBeNull()
    expect(pages).toHaveLength(0)
    await back()
    expect(pages.at(-1)).toMatchObject({ tab: 'cases', sub: null })
  })

  it('a step added while our back is on its way waits for it to arrive', async () => {
    startBackButton({ tab: 'cases', sub: null }, () => {})
    pushPage({ tab: 'kit', sub: 'kitroom' })
    const { getByText, container } = render(<Swap />)
    const base = window.history.state.tmSeq - 1
    const realBack = window.history.back
    let held = 0
    window.history.back = () => { held += 1 } // the back is "on its way"
    try {
      fireEvent.click(getByText('Close A'))
      await settle()
      expect(held).toBe(1)
      const before = window.history.length
      pushPage({ tab: 'me', sub: null })
      expect(window.history.length).toBe(before) // queued, not pushed over A's step
    } finally { window.history.back = realBack }
    await back() // the held back arrives
    expect(window.history.state.tmNav).toMatchObject({ tab: 'me', sub: null })
    expect(window.history.state.tmSeq).toBe(base + 1)
    expect(container.querySelector('[data-named]')).toBeNull()
  })
})

// Brent, 19 Nov 2026: back from Meetings → agenda went to Cases. Every screen
// drawn over the page (a fixed, full-screen layer) must take the back button.
describe('every overlay takes the back button', () => {
  it('each full-screen layer in the pages calls useBackLayer', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const EXEMPT = {
      'src/pages/cases/NoticeSheet.jsx': 'supplier emails waiting to send — closed only by choosing send or skip',
      'src/pages/voice/VoiceSheet.jsx': 'unreachable since the microphone was removed',
      'src/pages/PreferenceCards.jsx': 'opened only through GuideView, which holds the layer'
    }
    const files = []
    const walk = d => readdirSync(d).forEach(f => {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.jsx$/.test(f) && !/\.test\./.test(f)) files.push(p)
    })
    walk('src/pages'); walk('src/kit')
    const missing = files.filter(f => /position: 'fixed',? *inset: 0/.test(readFileSync(f, 'utf8'))
      && !/useBackLayer/.test(readFileSync(f, 'utf8')) && !EXEMPT[f])
    expect(missing).toEqual([])
  })
})
