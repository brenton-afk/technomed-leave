import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { STAFF, isSameStaff, getStaffByName } from './staffConfig.js'

// ─── Mat, never Matt ─────────────────────────────────────────────────────────
// "All references to Mat Usher in the portal should be Mat not Matt. Please fix
// in ALL areas."
//
// Two of the three were already right: `firstName` was Mat, and a booking title
// reading "(Matt)" is already tidied to Mat on the card. The one that was not is
// `name` — which is what the assignee dropdowns, the PIN screen, the admin list
// and every worklist item show, and which read "Matthew Usher".

const mat = STAFF.find(s => s.email === 'mat@technomed.com.au')

describe('what the portal calls him', () => {
  it('is Mat', () => {
    expect(mat.firstName).toBe('Mat')
    expect(mat.name).toBe('Mat Usher')
  })

  it('is Mat in the rep list too', () => {
    const source = readFileSync(join(__dirname, 'staffConfig.js'), 'utf8')
    expect(source).toMatch(/ATTENDING_REPS = \[[^\]]*'Mat'[^\]]*\]/)
    expect(source).not.toMatch(/ATTENDING_REPS = \[[^\]]*'Matt'/)
  })

  it('is never Matt or Matthew anywhere a person reads', () => {
    // Walks the source. `aka` is the one allowed mention, because it is a list
    // of spellings to recognise rather than one to show.
    const roots = ['pages', 'clinicalPlan', 'design', 'scanner']
    const offenders = []
    const walk = dir => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) { walk(path); continue }
        if (!/\.jsx?$/.test(entry) || entry.includes('.test.')) continue
        const text = readFileSync(path, 'utf8')
        for (const line of text.split('\n')) {
          if (!/\bMatt(?:hew)?\b/.test(line)) continue
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue   // a comment explaining it
          if (/aka\s*:/.test(line)) continue              // spellings to recognise
          offenders.push(`${path}: ${line.trim().slice(0, 70)}`)
        }
      }
    }
    for (const root of roots) walk(join(__dirname, root))
    expect(offenders).toEqual([])
  })
})

describe('the names already written down', () => {
  // Renaming somebody orphans every string stored before the rename — a
  // worklist item, a leave application, a calendar title. Mat was "Matthew
  // Usher" until October 2026 and a task assigned to him then is still his.
  it('still recognises what he used to be called', () => {
    expect(isSameStaff('Matthew Usher', mat)).toBe(true)
    expect(getStaffByName('Matthew Usher')?.email).toBe('mat@technomed.com.au')
  })

  it('still recognises what people type', () => {
    for (const written of ['Mat', 'Matt', 'Matthew', 'Mat Usher', 'mat usher']) {
      expect(isSameStaff(written, mat), written).toBe(true)
    }
  })

  it('does not match somebody else', () => {
    const ben = STAFF.find(s => s.firstName === 'Ben')
    expect(isSameStaff('Matt', ben)).toBe(false)
    expect(isSameStaff('', mat)).toBe(false)
    expect(isSameStaff(null, mat)).toBe(false)
  })

  it('is used wherever an assignee is compared', () => {
    // Three places decide whether a task is yours: the Mine filter, the nudge
    // on the home screen, and who gets the summary email. All three compared
    // on the exact name, so all three would have dropped his old items.
    const check = [
      ['pages/Projects.jsx', __dirname],
      ['pages/PromptBanner.jsx', __dirname]
    ]
    for (const [file, root] of check) {
      expect(readFileSync(join(root, file), 'utf8'), file).toMatch(/isSameStaff\(/)
    }
    const agent = readFileSync(join(__dirname, '..', 'api', 'meetings', 'agent.js'), 'utf8')
    expect(agent).toMatch(/isSameStaff\(it\.assignee, staff\)/)
  })
})

describe('Xero still finds him', () => {
  it('matches on the surname, which did not change', () => {
    // Xero holds whatever payroll holds — likely "Matthew Usher" still. The
    // lookup tries the full name, then a contains, then the surname. Only the
    // last of those survives the rename, which is worth knowing rather than
    // discovering at payroll.
    const source = readFileSync(
      join(__dirname, '..', 'api', '_xeroClient.js'), 'utf8')
    expect(source).toMatch(/e\.LastName\.toLowerCase\(\) === lastName/)
    expect(mat.name.split(' ').pop()).toBe('Usher')
  })
})
