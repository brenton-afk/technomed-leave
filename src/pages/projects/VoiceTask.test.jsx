import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import VoiceTask, { voiceDraft } from './VoiceTask.jsx'

// Brent, 11 Nov 2026: add a to-do on My To Do by voice. It fills the quick-add
// box; Add still has to be tapped.

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('voiceDraft', () => {
  it('takes the to-do the reader found', () => {
    expect(voiceDraft({ transcript: 'x', command: { intent: 'todo', todo: { task: 'Chase the invoice', assignee: 'Toni Example', due_date: '2026-11-13' } } }))
      .toEqual({ task: 'Chase the invoice', assignee: 'Toni Example', due: '2026-11-13' })
  })
  it('falls back to the words said when it was not read as a to-do', () => {
    expect(voiceDraft({ transcript: 'Order more drapes', command: { intent: 'unclear' } }))
      .toEqual({ task: 'Order more drapes', assignee: 'Unassigned', due: '' })
  })
})

describe('the microphone', () => {
  it('records, sends, and hands back the draft', async () => {
    const stop = vi.fn()
    class FakeRecorder {
      static isTypeSupported() { return true }
      constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm' }
      start() { this.state = 'recording' }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['a'], { type: 'audio/webm' }) }); this.onstop?.() }
    }
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) } })
    const fetchMock = vi.fn(async () => ({ json: async () => ({ transcript: 'remind me to ring Calvary', command: { intent: 'todo', todo: { task: 'Ring Calvary', assignee: 'Unassigned', due_date: '' } } }) }))
    vi.stubGlobal('fetch', fetchMock)
    const onHeard = vi.fn()
    render(<VoiceTask user={{ token: 't' }} onHeard={onHeard} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a task by voice' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop and read the task' }))
    await waitFor(() => expect(onHeard).toHaveBeenCalled())
    expect(onHeard.mock.calls[0][0]).toMatchObject({ task: 'Ring Calvary', transcript: 'remind me to ring Calvary' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/calendar/today?action=voice')
    expect(stop).toHaveBeenCalled()
  })
})
