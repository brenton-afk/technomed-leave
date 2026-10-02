import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useUnread } from './unread.js'

// The number on the Messages tab. Without it the only way to know something has
// been said is to open the tab and look, which is the habit the whole feature
// exists to replace — and notifications only reach the people who turned them
// on, on the device they turned them on for.

const overview = channels => vi.fn(async () => ({
  ok: true, json: async () => ({ channels })
}))

beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

describe('counting what is waiting', () => {
  it('adds up every channel', async () => {
    global.fetch = overview([{ id: 'general', unread: 2 }, { id: 'spine', unread: 3 }])
    const { result } = renderHook(() => useUnread('tok'))
    await waitFor(() => expect(result.current.count).toBe(5))
  })

  it('is nothing when everything has been read', async () => {
    global.fetch = overview([{ id: 'general', unread: 0 }])
    const { result } = renderHook(() => useUnread('tok'))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(result.current.count).toBe(0)
  })

  it('does not ask when nobody is signed in', async () => {
    global.fetch = overview([])
    renderHook(() => useUnread(null))
    await new Promise(r => setTimeout(r, 10))
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('does not ask while the tab is hidden', async () => {
    // A phone in a pocket overnight should not be polling anything.
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    global.fetch = overview([{ id: 'general', unread: 9 }])
    renderHook(() => useUnread('tok'))
    await new Promise(r => setTimeout(r, 10))
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('stays at nothing rather than breaking when the request fails', async () => {
    // A badge that cannot be fetched is a badge that does not appear. There is
    // nothing useful to say about it and the app works either way.
    global.fetch = vi.fn(async () => { throw new Error('offline') })
    const { result } = renderHook(() => useUnread('tok'))
    await new Promise(r => setTimeout(r, 10))
    expect(result.current.count).toBe(0)
  })

  it('signs the request as the person asking', async () => {
    global.fetch = overview([])
    renderHook(() => useUnread('tok'))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
  })
})
