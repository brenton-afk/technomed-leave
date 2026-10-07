import { describe, it, expect } from 'vitest'
import { readBooking } from './parse.js'

// ─── An operation must never come back shorter than it was written ──────────
// The operation line is built by striking out every word that appears in a
// matched kit's name. That is right for a brand — "Mardon DIPLOMAT ACDF" is
// not an operation called Diplomat — and it has now taken a clinical word
// three times:
//
//   "C3/4 +/- C4/5"                 lost the +/-, which says the second level
//                                   may not be done at all
//   "Left proximal tibia…"          lost the bone and the side, because an
//                                   orthopaedic set is named after anatomy
//   "L1-L3 Pedicle Screw Removal"   lost "Removal", because there is a loan
//                                   set called "TM Screw Removal"
//
// Each was fixed by adding words to a keep list, which is a fix for the
// instance and not the class. This is the class: a corpus of real operations,
// each asserted to survive whole.
//
// The failure mode is what makes it worth this much: a missing word looks
// like a shorter description rather than a wrong one, so nothing about the
// card invites a second look. "Pedicle Screw" and "Pedicle Screw Removal" are
// opposite operations and only one of them is on the tray list.

const read = (procedure, kit) => readBooking(
  'Hollis - Thani',
  ['Surgeon: Thani', 'Patient: Hollis', 'Hospital: RHH',
    `Procedure: ${procedure}`, kit ? `Kit: ${kit}` : null].filter(Boolean).join('\n')
)?.operation || ''

/** Words a reader would notice the loss of. */
const meaningful = text => text
  .split(/\s+/)
  .map(w => w.replace(/^[(,[]+|[),\].]+$/g, ''))
  .filter(w => w && !/^(and|with|the|of|to|a|for)$/i.test(w))

const CASES = [
  // The three that actually happened.
  ['L1-L3 Pedicle Screw Removal', 'Nova'],
  ['C3/4 +/- C4/5', 'Diplomat'],
  ['Left proximal tibia, lateral and medial plates',
    'Synthes VA Proximal Tibia Set, Sterile Lateral VA Plates and Medial LCP Plates'],

  // Revisions and removals, where the verb is the whole point.
  ['Removal of L1-L3 pedicle screws', 'TM Screw Removal'],
  ['L4/5 revision PLIF', 'Diplomat'],
  ['Explant of infected cage', 'Diplomat'],
  ['Washout and debridement L4/5', 'Mariner'],
  ['Exchange of rods T10-L2', 'Mariner'],

  // Ordinary spine, with the kit named in the title as well.
  ['C5/6 ACDF', 'Diplomat (Consignment)'],
  ['L5/S1 PSF and PLIF', 'Diplomat and E4 Cages (Consignment)'],
  ['L3-S1 MIS Pedicle Screw Fixation', 'Mariner (DT LOAN) E4 Global PLIF (Consignment)'],
  ['C6 corpectomy fixation', 'ATHLET AND ASCOT PLATE'],
  ['Posterior cervical C3-5 decompression +/- lateral mass screws', 'Reform (Consignment)'],

  // Laterality and approach, which read as ordinary words and are not.
  ['Right L4/5 microdiscectomy', 'Dakota'],
  ['Bilateral L4/5 decompression', 'Dakota']
]

describe('every word of the operation survives', () => {
  it.each(CASES)('%s', (procedure, kit) => {
    const got = read(procedure, kit)
    for (const word of meaningful(procedure)) {
      expect(got, `"${word}" was dropped from "${procedure}"`).toMatch(
        new RegExp(word.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'i'))
    }
  })
})

describe('what it is still allowed to take out', () => {
  // The behaviour all of this exists for. A brand in the title is the system,
  // and repeating it inside the operation is the duplication the split was
  // written to remove.
  it('still takes a brand out of the operation', () => {
    expect(read('L4/5 PLIF DIPLOMAT', 'Diplomat').toLowerCase()).not.toContain('diplomat')
    expect(read('C5/6 ACDF Mariner', 'Mariner').toLowerCase()).not.toContain('mariner')
  })

  it('and still keeps what the surgery is', () => {
    expect(read('L4/5 PLIF DIPLOMAT', 'Diplomat')).toMatch(/L4\/5/)
    expect(read('L4/5 PLIF DIPLOMAT', 'Diplomat')).toMatch(/PLIF/i)
  })
})
