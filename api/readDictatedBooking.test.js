import { describe, it, expect } from 'vitest'
import { promptFor } from './_readDictatedBooking.js'

// The transcription worked, the transcript was accurate and on screen, and the
// model still reported that it had no text to work from. It was right: the
// prompt promised a transcription and did not carry one.

describe('the prompt sent to the model', () => {
  const SAID = 'Cooper, Ibbett, RHH, Friday the second, L4 5 PLIF, Diplomat plus an LHC cage'

  it('contains what the person actually said', () => {
    expect(promptFor(SAID, '2026-09-28')).toContain(SAID)
  })

  it('refuses to build one with nothing in it', () => {
    // A prompt that announces a transcription and carries none asks the model
    // to invent one. Better to fail here than to ship an empty promise.
    for (const nothing of ['', '   ', null, undefined]) {
      expect(() => promptFor(nothing, '2026-09-28')).toThrow(/Nothing could be heard/)
    }
  })

  it('tells the model what day it is, so spoken dates resolve', () => {
    // "Friday the second" is only meaningful relative to now.
    const prompt = promptFor(SAID, '2026-09-28')
    expect(prompt).toContain('2026-09-28')
    expect(prompt).toContain('Monday')
  })

  it('names the surgeons and systems the transcription will have mangled', () => {
    const prompt = promptFor(SAID, '2026-09-28')
    expect(prompt).toContain('Ibbett')
    expect(prompt).toContain('Diplomat')
    expect(prompt).toContain('Peters-Willke')
  })

  it('forbids returning anything but a surname', () => {
    expect(promptFor(SAID, '2026-09-28')).toMatch(/SURNAME ONLY/)
  })
})
