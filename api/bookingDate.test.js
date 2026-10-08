import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─── The saved booking carries the day it is actually on ─────────────────────
// "When a booking is moved in the portal and the calendar entry follows it, we
// need to ensure that the date in the description gets altered in the calendar
// entry. So that the information is accurate."
//
// The writer for this lives in labelledFields.js and is tested there. What is
// tested here is that the save path calls it — a helper that exists and is
// never reached fixes nothing, and the unit tests around it all pass either
// way. There is no harness for these handlers, so this reads the source.

const SOURCE = readFileSync(join(__dirname, 'calendar', 'today.js'), 'utf8')
const SAVE = SOURCE.slice(
  SOURCE.indexOf('async function handleSave'),
  SOURCE.indexOf('async function handleCreate'))

describe('saving a booking that has moved', () => {
  it('puts the written date through the writer that corrects it', () => {
    expect(SAVE).toMatch(/withDateFollowing\(patch\.description, onDay\)/)
  })

  it('corrects it to the day the booking lands on, not the one it left', () => {
    // patch.start is the new day when the save is a move, and absent when it
    // is not — so the fallback is the day the event is already on. Reading
    // `current` first would write the old date back on every move, which is
    // the bug with an extra step.
    expect(SAVE).toMatch(
      /const onDay = \(patch\.start\?\.dateTime \|\| ''\)\.slice\(0, 10\) \|\| wasOn/)
  })

  it('does it before the event is written, not after', () => {
    // An afterthought here is a second API call, a second revision in the
    // calendar's history, and a window where the entry is wrong.
    expect(SAVE.indexOf('withDateFollowing'))
      .toBeLessThan(SAVE.indexOf('await updateCalendarEvent'))
  })

  it('leaves the date out of the fields a person can type into', () => {
    // The date is the event's start. Offering it as an editable field would
    // make it possible to save a booking whose notes disagree with the day it
    // is on — which is the thing this is all for.
    expect(SOURCE).toMatch(
      /const EDITABLE = \['patient', 'surgeon', 'procedure', 'kit', 'hospital'\]/)
  })
})
