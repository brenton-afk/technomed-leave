import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import DictateBooking from './DictateBooking.jsx'

// Two things matter here and neither is the transcription. The microphone must
// close, every time, or the phone shows a recording indicator the user cannot
// explain. And what was heard must be shown, because the one field speech
// recognition reliably gets wrong is the patient's surname.

let tracks, recorderInstance, posted

class FakeRecorder {
  constructor(stream, options) {
    this.stream = stream
    this.mimeType = options?.mimeType || 'audio/webm'
    this.state = 'inactive'
    recorderInstance = this
  }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: { size: 50000 } })
    this.onstop?.()
  }
}
FakeRecorder.isTypeSupported = () => true

beforeEach(() => {
  posted = null
  tracks = [{ stop: vi.fn() }]
  global.MediaRecorder = FakeRecorder
  global.navigator.mediaDevices = {
    getUserMedia: vi.fn(async () => ({ getTracks: () => tracks }))
  }
  global.Blob = class { constructor(parts, opts) { this.size = 50000; this.type = opts?.type } }
  global.FileReader = class {
    readAsDataURL() { setTimeout(() => this.onload({ target: this }), 0) }
    get result() { return 'data:audio/webm;base64,QUJD' }
  }
  global.fetch = vi.fn(async (url, init) => {
    posted = JSON.parse(init.body)
    return {
      ok: true, status: 200,
      json: async () => ({
        ok: true,
        transcript: 'Cooper, Ibbett, RHH, Friday the second, L4 5 PLIF, Diplomat plus an LHC cage',
        unclear: '',
        fields: {
          patient: 'Cooper', surgeon: 'Ibbett', date: '2026-10-02', hospital: 'RHH',
          procedure: 'L4/5 PLIF', kit: 'Diplomat + LHC cage', systems: ['Diplomat'], note: ''
        }
      })
    }
  })
})

afterEach(() => { vi.restoreAllMocks() })

const show = (props = {}) =>
  render(<DictateBooking user={{ token: 't' }} onFilled={() => {}} onClose={() => {}} {...props} />)

async function speak() {
  fireEvent.click(screen.getByRole('button', { name: /Start speaking/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: /Stop/ })).toBeInTheDocument())
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Stop/ })) })
}

describe('the microphone', () => {
  it('is released the moment recording stops', async () => {
    // A live microphone the user cannot see is its own problem, and iOS leaves
    // the indicator on until the track actually ends.
    show()
    await speak()
    expect(tracks[0].stop).toHaveBeenCalled()
  })

  it('is released if the panel closes mid-recording', async () => {
    const { unmount } = show()
    fireEvent.click(screen.getByRole('button', { name: /Start speaking/ }))
    await waitFor(() => expect(recorderInstance.state).toBe('recording'))
    unmount()
    expect(tracks[0].stop).toHaveBeenCalled()
  })

  it('says where to fix a denied permission', async () => {
    // The fix is in iOS Settings, not anywhere in the app, so the message has
    // to point out of the app.
    global.navigator.mediaDevices.getUserMedia = vi.fn(async () => { throw new Error('denied') })
    show()
    fireEvent.click(screen.getByRole('button', { name: /Start speaking/ }))
    await waitFor(() => expect(screen.getByText(/Settings → Safari → Microphone/)).toBeInTheDocument())
  })
})

describe('what came back', () => {
  it('shows what was heard, not only what was understood', async () => {
    // Speech recognition has never heard of Petrusma or Ibbett. A mangled
    // surname is obvious in the transcript and invisible once it is sitting in
    // a form field looking confident.
    show()
    await speak()
    await waitFor(() => expect(screen.getByText(/Cooper, Ibbett, RHH/)).toBeInTheDocument())
  })

  it('shows what it understood, not only what it heard', async () => {
    // "Use this" used to ask you to approve a reading you had not been shown.
    show()
    await speak()
    await waitFor(() => expect(screen.getByText('Cooper')).toBeInTheDocument())
    expect(screen.getByText('Ibbett')).toBeInTheDocument()
    expect(screen.getByText('2026-10-02')).toBeInTheDocument()
    expect(screen.getByText('L4/5 PLIF')).toBeInTheDocument()
  })

  it('does nothing until the person chooses', async () => {
    const onFilled = vi.fn()
    show({ onFilled })
    await speak()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Book it' })).toBeInTheDocument())
    expect(onFilled).not.toHaveBeenCalled()
  })

  it('can add it straight away', async () => {
    // What was actually wanted: speak, glance, book.
    const onFilled = vi.fn()
    show({ onFilled })
    await speak()
    fireEvent.click(await screen.findByRole('button', { name: 'Book it' }))
    expect(onFilled).toHaveBeenCalledWith(
      expect.objectContaining({ patient: 'Cooper' }),
      { andCreate: true })
  })

  it('can open it in the form first', async () => {
    const onFilled = vi.fn()
    show({ onFilled })
    await speak()
    fireEvent.click(await screen.findByRole('button', { name: 'Check it first' }))
    expect(onFilled).toHaveBeenCalledWith(expect.objectContaining({ patient: 'Cooper' }))
    expect(onFilled.mock.calls[0][1]).toBeUndefined()
  })

  it('will not add one that is missing a surname', async () => {
    // Three things a booking cannot be made without. Missing any, the only way
    // on is through the form where it can be typed in.
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        ok: true, transcript: 'Ibbett, Friday', unclear: 'No patient surname was said.',
        fields: { patient: '', surgeon: 'Ibbett', date: '2026-10-02', hospital: '', procedure: '', kit: '', systems: [] }
      })
    }))
    show()
    await speak()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Book it' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Check it first' })).not.toBeDisabled()
  })

  it('sends the audio rather than anything identifying', async () => {
    show()
    await speak()
    await waitFor(() => expect(posted).not.toBeNull())
    expect(Object.keys(posted).sort()).toEqual(['audio', 'contentType'])
  })

  it('surfaces a refusal from the server as it was written', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 400,
      json: async () => ({ error: 'Nothing could be heard in that recording. Try again, closer to the phone.' })
    }))
    show()
    await speak()
    await waitFor(() =>
      expect(screen.getByText(/Nothing could be heard/)).toBeInTheDocument())
  })
})

// ─── Task 2: when the API will not answer ────────────────────────────────────
// Ben got a raw 400 invalid_request_error on this screen, reading "Your credit
// balance is too low to access the Anthropic API". The API's own JSON on a
// phone reads as the app being broken rather than a bill being unpaid.
describe('when Claude is unavailable', () => {
  const failWith = message => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 400, json: async () => ({ error: message })
    }))
  }

  // What the server sends now: the sentence, never the cause.
  const FRIENDLY = 'Voice booking is unavailable right now — please fill in the form below.'

  it('shows the sentence, not the API’s JSON', async () => {
    failWith(FRIENDLY)
    show()
    await speak()
    await waitFor(() =>
      expect(screen.getByText(/Voice booking is unavailable right now/)).toBeInTheDocument())
  })

  it('tells the person what to do instead', async () => {
    // The manual form is right underneath. That is what makes this a workable
    // answer rather than a dead end.
    failWith(FRIENDLY)
    show()
    await speak()
    await waitFor(() =>
      expect(screen.getByText(/fill in the form below/)).toBeInTheDocument())
  })

  it('leaves the way out, so the form can be used', async () => {
    const onClose = vi.fn()
    failWith(FRIENDLY)
    show({ onClose })
    await speak()
    await waitFor(() =>
      expect(screen.getByText(/Voice booking is unavailable/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Close|Cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('never puts a status code or a request id on screen', async () => {
    // The guard against this regressing: the screen shows whatever the server
    // sends, so the discipline has to hold on the server. If it ever sends the
    // raw thing again, this is what notices.
    failWith(FRIENDLY)
    show()
    await speak()
    await waitFor(() =>
      expect(screen.getByText(/Voice booking is unavailable/)).toBeInTheDocument())
    expect(document.body.textContent).not.toMatch(/invalid_request_error|request_id|\b400\b/)
  })
})
