import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'
import VoiceSheet from './voice/VoiceSheet.jsx'

// ─── "Hey TM Portal…" ────────────────────────────────────────────────────────
// "I want a voice option to be able to add/amend list orders or add a reminder
// to the portal. Like a speak function that says 'Hey TM Portal, I want to add
// a booking', or 'Hey TM portal, I want to add a reminder', 'Hey TM portal I
// want to update the list order for tomorrow'."

const USER = { name: 'Brenton Lovering', email: 'brenton@technomed.com.au', token: 'tok' }

let heardBack
let stopped

class FakeRecorder {
  static isTypeSupported() { return true }
  constructor() { this.state = 'inactive'; this.ondataavailable = null; this.onstop = null }
  start() {
    this.state = 'recording'
    setTimeout(() => this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) }), 0)
  }
  stop() { this.state = 'inactive'; this.onstop?.() }
}

beforeEach(() => {
  stopped = 0
  heardBack = {
    transcript: 'Hey TM Portal, I want to add a reminder to get the Athlet tray back from RHH on Thursday',
    command: {
      intent: 'reminder',
      confidence: 'high',
      why: 'Getting the Athlet tray back from RHH on Thursday.',
      reminder: { kind: 'return', thing: 'Athlet', from: 'RHH', to: '', note: '', date: '2026-10-15' }
    }
  }

  global.MediaRecorder = FakeRecorder
  global.navigator.mediaDevices = {
    getUserMedia: vi.fn(async () => ({
      getTracks: () => [{ stop: () => { stopped += 1 } }]
    }))
  }
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, ...heardBack }) }))

  // jsdom's FileReader does not do Blobs the way Safari does.
  global.FileReader = class {
    readAsDataURL() { setTimeout(() => this.onload?.(), 0) }
    get result() { return 'data:audio/webm;base64,AAAA' }
  }
})
afterEach(() => vi.restoreAllMocks())

const open = (props = {}) =>
  render(<VoiceSheet user={USER} onClose={() => {}} onPlan={() => {}}
    weekdayOf={() => 'Thursday'} {...props} />)

const speak = async () => {
  fireEvent.click(screen.getByText('Start speaking'))
  await waitFor(() => expect(screen.getByText('Done')).toBeInTheDocument())
  fireEvent.click(screen.getByText('Done'))
  await waitFor(() => expect(screen.getByText('Is this right?')).toBeInTheDocument())
}

describe('before anybody speaks', () => {
  it('says how to use it, wake words and all', async () => {
    open()
    expect(screen.getByText(/Hey TM Portal/)).toBeInTheDocument()
    expect(screen.getByText(/wake words are optional/i)).toBeInTheDocument()
  })

  it('has a way out from the very first screen', async () => {
    // "There can't be situations when you get stuck in a part of the app."
    const onClose = vi.fn()
    open({ onClose })
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('what it does with what it heard', () => {
  it('shows the words back as a quotation', async () => {
    // A mangled surname is obvious as a quotation and invisible once it sits
    // in a form box.
    open()
    await speak()
    expect(screen.getByText(/add a reminder to get the Athlet tray back/)).toBeInTheDocument()
  })

  it('takes the wake words off and says it did', async () => {
    open()
    await speak()
    expect(screen.getByText(/Wake words heard and ignored/)).toBeInTheDocument()
    expect(screen.queryByText(/Hey TM Portal, I want to/)).not.toBeInTheDocument()
  })

  it('says what it is about to do, in sentences', async () => {
    open()
    await speak()
    expect(screen.getByText('Task · Get a tray back')).toBeInTheDocument()
    expect(screen.getByText('Get Athlet back from RHH')).toBeInTheDocument()
    expect(screen.getByText('Thursday 15 October')).toBeInTheDocument()
  })

  it('does nothing until somebody taps', async () => {
    // The whole design. Nothing is written by the router.
    const onPlan = vi.fn()
    open({ onPlan })
    await speak()
    expect(onPlan).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Do it'))
    expect(onPlan).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({ intent: 'reminder' })
    }))
  })

  it('lets you throw it away and start again', async () => {
    open()
    await speak()
    fireEvent.click(screen.getByText('Not right'))
    expect(screen.getByText('Start speaking')).toBeInTheDocument()
  })

  it('warns when it was not certain', async () => {
    heardBack.command.confidence = 'low'
    open()
    await speak()
    expect(screen.getByText(/worth a careful read/)).toBeInTheDocument()
  })

  it('sends a booking to the form rather than doing it', async () => {
    heardBack = {
      transcript: 'Add a booking for Cooper with Ibbett at RHH on Friday',
      command: { intent: 'booking', confidence: 'high', why: 'A booking.' },
      booking: { fields: { patient: 'Cooper', surgeon: 'Ibbett' } }
    }
    open()
    await speak()
    expect(screen.getByText('Open the form')).toBeInTheDocument()
  })
})

describe('when it could not tell', () => {
  beforeEach(() => {
    heardBack = {
      transcript: 'mmm hold on a second',
      command: { intent: 'unclear', confidence: 'low', why: 'Could not tell what that was.' }
    }
  })

  it('says so rather than guessing', async () => {
    // A router with no way to say this puts every mumble into whichever
    // branch is nearest, which is how a cough becomes a booking.
    open()
    await speak()
    expect(screen.getByText('Could not tell')).toBeInTheDocument()
    expect(screen.getByText('Could not tell what that was.')).toBeInTheDocument()
  })

  it('offers no way to act on it', async () => {
    open()
    await speak()
    expect(screen.queryByText('Do it')).not.toBeInTheDocument()
    expect(screen.getByText('Say it again')).toBeInTheDocument()
  })
})

describe('the microphone itself', () => {
  it('releases it as soon as the recording stops', async () => {
    // A live microphone the user cannot see is its own problem, and iOS
    // leaves the indicator on until the track ends.
    open()
    await speak()
    expect(stopped).toBeGreaterThan(0)
  })

  it('says so plainly when there is no permission', async () => {
    global.navigator.mediaDevices.getUserMedia =
      vi.fn(async () => { throw new Error('denied') })
    open()
    fireEvent.click(screen.getByText('Start speaking'))
    await waitFor(() =>
      expect(screen.getByText(/microphone is not available/)).toBeInTheDocument())
    expect(screen.getByText('Try again')).toBeInTheDocument()
  })

  it('passes the server’s message through rather than hiding it', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ error: 'Nothing could be heard in that recording. Try again, closer to the phone.' })
    }))
    open()
    fireEvent.click(screen.getByText('Start speaking'))
    await waitFor(() => expect(screen.getByText('Done')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Done'))
    await waitFor(() =>
      expect(screen.getByText(/closer to the phone/)).toBeInTheDocument())
  })

  it('still offers a way out when it has failed', async () => {
    const onClose = vi.fn()
    global.navigator.mediaDevices.getUserMedia =
      vi.fn(async () => { throw new Error('denied') })
    open({ onClose })
    fireEvent.click(screen.getByText('Start speaking'))
    await waitFor(() =>
      expect(screen.getByText(/microphone is not available/)).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalled()
  })
})
