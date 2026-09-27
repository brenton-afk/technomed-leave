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

  it('does not fill the form until the person says so', async () => {
    const onFilled = vi.fn()
    show({ onFilled })
    await speak()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Use this' })).toBeInTheDocument())
    expect(onFilled).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Use this' }))
    expect(onFilled).toHaveBeenCalledWith(expect.objectContaining({
      patient: 'Cooper', surgeon: 'Ibbett', date: '2026-10-02'
    }))
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
