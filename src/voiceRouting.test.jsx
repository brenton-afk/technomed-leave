import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─── One button, four things, and where each one goes ────────────────────────
// "I want a voice option to be able to add/amend list orders or add a reminder
// to the portal."
//
// The routing is split across three files on purpose and that is exactly the
// kind of arrangement that rots quietly: the sheet reads a command, the app
// acts on two of the four, and the Cases tab resolves the two that need the
// week. These check the seams, because the failure here is not a crash — it is
// a command that is understood and then silently goes nowhere.

const ROOT = process.cwd()
const read = p => readFileSync(join(ROOT, p), 'utf8')

const APP = read('src/App.jsx')
const CASE_WEEK = read('src/pages/CaseWeek.jsx')
const SHEET = read('src/pages/voice/VoiceSheet.jsx')
const COMMAND = read('src/voice/command.js')
const SERVER = read('api/_voiceCommand.js')

describe('the microphone is where it was asked to be', () => {
  it('is on every screen, not inside one', () => {
    // "The point of voice is that you don't have to navigate first — a button
    // you have to find defeats it." It is rendered by the shell, outside
    // renderContent, so it does not belong to a tab.
    const atRender = APP.indexOf('function renderContent')
    const atButton = APP.indexOf('aria-label="Speak a command"')
    expect(atButton).toBeGreaterThan(-1)
    // After the render function's definition means it is in the shell's own
    // JSX rather than in a branch of it.
    expect(atButton).toBeGreaterThan(atRender)
  })

  it('floats clear of the bottom bar rather than joining it', () => {
    // Five is the limit a bottom bar stays scannable at, and the bar is full.
    expect(APP).toMatch(/aria-label="Speak a command"[\s\S]{0,400}position: 'fixed'/)
    expect(APP).toMatch(/aria-label="Speak a command"[\s\S]{0,500}env\(safe-area-inset-bottom/)
  })

  it('is not offered to somebody who is not signed in', () => {
    expect(APP).toMatch(/\{user && \([\s\S]{0,300}aria-label="Speak a command"/)
  })

  it('actually opens the sheet when it is tapped', () => {
    // Added after a deliberate break went unnoticed: the button was still
    // there, still labelled, and tapping it did nothing. A dead control is
    // worse than no control, and this is the only test that sees it.
    expect(APP).toMatch(/onClick=\{\(\) => setMicOpen\(true\)\}/)
    expect(APP).toMatch(/\{micOpen && \(\s*<VoiceSheet/)
  })
})

describe('each of the four goes somewhere', () => {
  it('sends a reminder to the calendar task action', () => {
    expect(APP).toMatch(/intent === 'reminder'[\s\S]{0,300}action=task/)
  })

  it('sends a task-list item to the worklist', () => {
    expect(APP).toMatch(/intent === 'todo'[\s\S]{0,400}action=add-task/)
  })

  it('hands a booking and a list order to the tab holding the week', () => {
    // Which booking "we're second tomorrow" means cannot be worked out
    // without the cases, and the Cases tab already has them.
    expect(APP).toMatch(/intent === 'booking' \|\| command\.intent === 'listOrder'/)
    expect(APP).toMatch(/setSpoken\(heard\)[\s\S]{0,80}navigate\(\{ tab: 'cases' \}\)/)
  })

  it('opens the booking form filled in rather than asking again', () => {
    expect(CASE_WEEK).toMatch(/setSpokenBooking\(spoken\.booking\?\.fields/)
  })

  it('applies a list order only to a case it actually matched', () => {
    expect(CASE_WEEK).toMatch(/matchCase\(plan, command\.listOrder\)/)
    expect(CASE_WEEK).toMatch(/if \(!match\)[\s\S]{0,160}setNotice/)
  })

  it('tells somebody when it could not tell which case', () => {
    // Silence here is the worst outcome: the command was understood, the tab
    // changed, and nothing happened.
    expect(CASE_WEEK).toMatch(/setNotice\(why \|\|/)
  })

  it('clears the command once it has been acted on', () => {
    // Otherwise it fires again on the next render of the week.
    expect(APP).toMatch(/onSpokenDone=\{\(\) => setSpoken\(null\)\}/)
    expect(CASE_WEEK).toMatch(/onSpokenDone\?\.\(\)/)
  })
})

describe('nothing happens without a tap', () => {
  it('the router writes nothing', () => {
    // Every one of the four has its own action behind its own checks. This
    // reads and returns; the app calls the action after somebody confirms.
    expect(SERVER).not.toMatch(/createTaskEvent|saveWorklistItem|updateCalendarEvent/)
  })

  it('the sheet only reports the plan upwards', () => {
    expect(SHEET).toMatch(/onClick=\{\(\) => onPlan\(heard\)\}/)
    // It posts to exactly one endpoint, and that endpoint is the read-only one.
    const posts = SHEET.match(/fetch\('([^']+)'/g) || []
    expect(posts).toHaveLength(1)
    expect(posts[0]).toContain('action=voice')
  })

  it('an unclear command offers no way to act on it at all', () => {
    expect(SHEET).toMatch(/\{!unclear && \([\s\S]{0,400}onPlan\(heard\)/)
  })
})

describe('what the command reader refuses', () => {
  it('checks every field against what this app actually has', () => {
    // A model that invents a task kind called "collect" produces a task the
    // calendar cannot draw.
    expect(COMMAND).toMatch(/TASK_KINDS\.find\(k => k\.key === given\.kind\)/)
    expect(COMMAND).toMatch(/SESSION_IDS\.includes\(given\.session\)/)
    expect(COMMAND).toMatch(/STAFF\.find\(s => s\.name === given\.assignee\)/)
  })

  it('strips identifiers on the way out whatever the prompt asked for', () => {
    // A spoken command is free prose, and free prose is exactly where
    // somebody says a patient's full name out loud.
    expect(SERVER).toMatch(/stripIdentifiers/)
    expect(SERVER).toMatch(/patient: clean\(out\.listOrder\.patient, 40\)\.split\(/)
  })

  it('reads a booking with the reader that already knows how', () => {
    // Two readers of the same sentence is how the two come to disagree.
    expect(SERVER).toMatch(/readDictatedBooking\(\{ audio, contentType \}\)/)
  })
})
