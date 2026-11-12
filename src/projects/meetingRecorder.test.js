import { describe, it, expect } from 'vitest'
import { elapsed, pickMime } from './meetingRecorder.js'
import { describe as say } from './liveMeeting.js'

describe('the meeting recorder', () => {
  it('shows how long it has been going', () => {
    expect(elapsed(0)).toBe('0:00')
    expect(elapsed(1000, 1000 + 754000)).toBe('12:34')
    expect(elapsed(1000, 1000 + 3723000)).toBe('1:02:03')
  })
  it('records in a format the phone can make', () => {
    expect(pickMime(t => t === 'audio/mp4')).toBe('audio/mp4')
    expect(pickMime(() => true)).toBe('audio/webm;codecs=opus')
    expect(pickMime(() => false)).toBe('')
  })
  it('says a progress note plainly', () => {
    expect(say({ kind: 'note', task: 'Order the plates', note: 'Ships Friday' })).toBe('Note on Order the plates: Ships Friday')
  })
})
