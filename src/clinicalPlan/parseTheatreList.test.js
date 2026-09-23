import { describe, it, expect } from 'vitest'
import { parseTheatreList, parseListDate, readPatientCell } from './parseTheatreList.js'
import { resolveE4Product, systemsInKit } from './systems.js'

// The real RHH email of 18 September, reproduced structurally with invented
// patient names. The structure is the point — the column order, the surgeon
// headings, two cases under one surgeon, and the first names and dates of birth
// that must never get past this file.

const LIST_HTML = `
<table>
<tr><td>Monday</td><td>21st September 2026</td><td></td><td></td><td></td><td>Neurosurgery</td></tr>
<tr><td>FOWLER</td><td>Theatre Number 11</td><td>List duration 08:00am (Anaesthetic Start) to 5:00pm - All Day List</td></tr>
<tr><td>Diplomat + E4</td><td>CHALMERS Rebecca</td><td></td><td></td><td></td><td>L5/S1 PLIF</td></tr>

<tr><td>Tuesday</td><td>22nd September 2026</td><td></td><td></td><td></td><td>Neurosurgery</td></tr>
<tr><td>PETERS-WILLKE</td><td>Theatre Number 11</td><td></td><td>List duration 08:00am (Anaesthetic Start) to 5:00pm - All Day List</td></tr>
<tr><td></td><td></td><td></td><td></td><td></td><td>C2/3 + C3/4 + C4/5 Laminectomy</td></tr>
<tr><td>KT Lonestar</td><td>STURROCK Lisa</td><td>15/9/1961</td><td>2</td><td>103</td><td>C3/4, C4/5 ACDF</td></tr>

<tr><td>Thursday</td><td>24th September 2026</td><td></td><td></td><td></td><td></td><td>Neurosurgery</td></tr>
<tr><td>THANI</td><td>Theatre Number 11</td><td></td><td></td><td></td><td>List duration 08:00am (Anaesthetic Start) to 5:00pm - All Day List</td></tr>
<tr><td>Shoreline</td><td>LAWRENCE Susette</td><td></td><td></td><td></td><td></td><td>C4/5, C5/6, C6/7 ACDF +/- C3/4</td></tr>
<tr><td>ATALLAH</td><td>Theatre Number 15</td><td></td><td></td><td>List duration 13:30pm (Anaesthetic Start) to 17:00pm - PM List</td></tr>
<tr><td>Mariner</td><td>FARROW Brock</td><td></td><td></td><td></td><td>T12-L4 pedicle screw &amp; rod removal</td></tr>

<tr><td>Friday</td><td>25th September 2026</td><td></td><td></td><td></td><td>Neurosurgery</td></tr>
<tr><td>GUPTA</td><td>Theatre Number 11</td><td></td><td>List duration 08:00am (Anaesthetic Start) to 5:00pm - All Day List</td></tr>
<tr><td>Shoreline</td><td>BENNETT Phillip</td><td></td><td></td><td></td><td>C4/5 ACDF</td></tr>
<tr><td>Diplomat insitu T10-L5 + Connectors + E4</td><td>BEHAN Karen</td><td>24/11/1965</td><td></td><td></td><td>L5/S1 PLIF +/- S2AI screws</td></tr>
</table>`

const parsed = parseTheatreList({ html: LIST_HTML })

describe('a week of cases in one email', () => {
  it('finds every case', () => {
    // Six cases across four days, which is a normal week.
    expect(parsed).toHaveLength(6)
  })

  it('keeps each case on its own day', () => {
    // The day heading sets the date for everything beneath it until the next.
    expect(parsed.map(c => c.date)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-24', '2026-09-24',
      '2026-09-25', '2026-09-25'
    ])
  })

  it('attributes two cases under one surgeon to that surgeon', () => {
    const friday = parsed.filter(c => c.date === '2026-09-25')
    expect(friday).toHaveLength(2)
    expect(friday.every(c => c.surgeon === 'Gupta')).toBe(true)
  })

  it('starts a new surgeon partway through a day', () => {
    // Thursday has Thani in theatre 11 and Atallah in theatre 15.
    const thursday = parsed.filter(c => c.date === '2026-09-24')
    expect(thursday.map(c => c.surgeon)).toEqual(['Thani', 'Atallah'])
    expect(thursday.map(c => c.theatre)).toEqual(['11', '15'])
  })

  it('reads a surgeon the hospital writes in full', () => {
    // The lists give surnames; the calendar uses the short form.
    expect(parsed.find(c => c.date === '2026-09-22').surgeon).toBe('JPW')
  })
})

describe('what must not get through', () => {
  it('keeps surnames and drops given names', () => {
    expect(parsed.map(c => c.patient)).toEqual(
      ['Chalmers', 'Sturrock', 'Lawrence', 'Farrow', 'Bennett', 'Behan'])
  })

  it('never returns a first name or a date of birth, anywhere', () => {
    // The list carries both. An ingestion path is exactly where the
    // surnames-only rule would quietly lapse, so this checks the whole payload
    // rather than only the patient field.
    const everything = JSON.stringify(parsed)
    for (const leaked of ['Rebecca', 'Lisa', 'Susette', 'Brock', 'Phillip', 'Karen']) {
      expect(everything, leaked).not.toContain(leaked)
    }
    for (const dob of ['15/9/1961', '24/11/1965']) {
      expect(everything, dob).not.toContain(dob)
    }
  })

  it('does not mistake a heading for a patient', () => {
    for (const heading of ['THEATRE', 'Neurosurgery', 'List duration 08:00am', '', 'DOB']) {
      expect(readPatientCell(heading), heading).toBeNull()
    }
  })

  it('reads a hyphenated or apostrophed surname whole', () => {
    expect(readPatientCell("O'BRIEN Patricia")).toBe("O'brien")
    expect(readPatientCell('PETERS-WILLKE Jens')).toBe('Peters-willke')
  })
})

describe('the kit and the procedure', () => {
  it('takes the kit from the left of the patient', () => {
    expect(parsed[0].kit).toBe('Diplomat + E4')
    expect(parsed.find(c => c.patient === 'Farrow').kit).toBe('Mariner')
  })

  it('takes the procedure from the right', () => {
    expect(parsed[0].procedure).toBe('L5/S1 PLIF')
    expect(parsed.find(c => c.patient === 'Lawrence').procedure)
      .toBe('C4/5, C5/6, C6/7 ACDF +/- C3/4')
  })

  it('is not fooled by the theatre and list-duration cells', () => {
    for (const c of parsed) {
      expect(c.kit, c.patient).not.toMatch(/theatre|duration|anaesthetic/i)
      expect(c.procedure, c.patient).not.toMatch(/theatre|duration|anaesthetic/i)
    }
  })

  it('keeps a kit line naming two systems intact', () => {
    // "Diplomat + E4" is two distributors. Losing half of it here would lose a
    // request nobody knows is missing.
    expect(parsed.find(c => c.patient === 'Behan').kit).toMatch(/Diplomat.*E4/)
  })
})

describe('when the reading is not certain', () => {
  it('marks a case that has everything as confident', () => {
    expect(parsed.every(c => c.confident)).toBe(true)
  })

  it('still offers a case whose surgeon could not be read', () => {
    // Dropping it would lose a real booking silently, which is the failure this
    // whole path exists to avoid.
    const odd = parseTheatreList({
      html: '<table><tr><td>Monday</td><td>21st September 2026</td></tr>'
        + '<tr><td>Kit X</td><td>MARSH Jane</td><td>Some procedure</td></tr></table>'
    })
    expect(odd).toHaveLength(1)
    expect(odd[0].patient).toBe('Marsh')
    expect(odd[0].surgeon).toBeNull()
    expect(odd[0].confident).toBe(false)
  })

  it('returns nothing for an email that is not a list', () => {
    expect(parseTheatreList({ text: 'Thanks team, all booked in. Cheers, Brent' })).toEqual([])
    expect(parseTheatreList({})).toEqual([])
  })
})

describe('the date heading', () => {
  it.each([
    ['21st September 2026', '2026-09-21'],
    ['1st October 2026', '2026-10-01'],
    ['24 December 2026', '2026-12-24'],
    ['not a date', null]
  ])('%s → %s', (text, expected) => {
    expect(parseListDate(text)).toBe(expected)
  })
})

describe('a bare "E4" on a kit line', () => {
  it('is the PLIF cages when it sits with Diplomat or Mariner', () => {
    // The lists name a distributor, not a product — E4 supply four of them, and
    // a loan request has to say which. Alongside Diplomat or Mariner it is a
    // posterior lumbar construct, so the E4 part is the interbody.
    expect(resolveE4Product('Diplomat + E4')).toBe('Global BMD PLIF')
    expect(resolveE4Product('Mariner + E4')).toBe('Global BMD PLIF')
    expect(resolveE4Product('Diplomat insitu T10-L5 + Connectors + E4')).toBe('Global BMD PLIF')
  })

  it('stays a question when it stands alone', () => {
    // Guessing a product here means a tray arriving that nobody can use, so an
    // unaccompanied "E4" reaches the review queue unresolved.
    expect(resolveE4Product('E4')).toBeNull()
    expect(resolveE4Product('E4 cages')).toBeNull()
  })

  it('leaves a line that already names the product alone', () => {
    for (const kit of ['E4 Global ALIF', 'Dakota ACDF', 'Reform Cervical']) {
      expect(resolveE4Product(kit), kit).toBeNull()
    }
  })

  it('resolves it for a real case off the list', () => {
    const behan = parsed.find(c => c.patient === 'Behan')
    expect(systemsInKit(behan.kit)).toContain('Diplomat')
    expect(systemsInKit(behan.kit)).toContain('Global BMD PLIF')
  })
})
