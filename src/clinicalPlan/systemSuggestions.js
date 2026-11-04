// ─── Which systems to offer for an operation ─────────────────────────────────
// "The portal should know that if the booking is a thoracolumbar fixation …
// then ACDF systems like Lonestar etc should not be options. The only options
// should be pedicle screw systems that we supply." — Brent, 3 Nov 2026.
//
// The rules below are Brent's, dictated on 3 Nov 2026. Each group is the short
// list of systems that fit one kind of operation; a surgeon row puts that
// surgeon's own choice first. Anything not offered is still one tap away
// behind "All systems" — this narrows the buttons, it never forbids a choice,
// because the rare case (a MOBIS conversion, back-up screws on an ALIF) is
// exactly the one that must still be bookable.
//
// Names are as the inventory spells them, so a suggestion writes the same kit
// line as tapping the button by hand. Northstar (Device) and REline
// (Nuvasive / Globus) are always distributor loan sets.
//
// Pre-ticking (Brent, 4 Nov 2026): on a booking entered by hand, the surgeon's
// usual systems are ticked for them (`pick`). A booking read from an email
// follows what the email asks for — this module does not touch those.

import { findImplantProcedures } from './procedureImplants.js'

/** Kinds of operation, each with its systems in the order they are offered. */
export const SYSTEM_GROUPS = {
  acdf: {
    label: 'ACDF',
    // Dakota is an integrated ACDF cage: RHH for Fowler and Atallah, and
    // Imogen Ibbett's at Calvary.
    systems: ['Lonestar', 'CYLOX', 'Shoreline', 'Dakota'],
    extras: ['TM Locking Distractor']
  },
  corpectomy: {
    label: 'Corpectomy',
    // Ascot and Athlet are almost exclusively cervical corpectomy, mostly at
    // RHH. Expandable corpectomy is X-Core (Nuvasive) or Fortify (Globus),
    // each with that company's ACP plate. Locking Distractor occasionally,
    // with Thani.
    systems: ['Athlet', 'Ascot', 'Nuvasive', 'Globus'],
    extras: ['TM Locking Distractor']
  },
  posteriorCervical: {
    label: 'Posterior cervical fusion',
    // Reform about 90% of the time. Northstar (SeaSpine) mostly for Dubey,
    // always a distributor loan set.
    systems: ['Reform Cervical', 'Northstar'],
    extras: []
  },
  pedicleScrews: {
    label: 'Pedicle screw fixation',
    // Thoracolumbar fixation ("PSF"), mostly trauma and degenerative cases
    // without cages. Firebird is almost only JPW's, so it is listed
    // last unless the surgeon row moves it up.
    systems: ['Diplomat', 'Mariner MIS', 'Mariner Open', 'Orthofix Firebird'],
    extras: ['Mariner Outrigger', 'TM Screw Removal']
  },
  plif: {
    label: 'PLIF / TLIF',
    // A cage and pedicle screws. Forza XP (expandable) goes with Firebird and
    // is predominantly JPW's. MOBIS is only the back-up when two PLIF cages
    // will not go in and it becomes a TLIF — extremely rare, so not offered.
    systems: ['Global BMD PLIF', 'Forza XP', 'Diplomat', 'Mariner MIS', 'Mariner Open', 'Orthofix Firebird'],
    extras: ['TM Screw Removal']
  },
  alif: {
    label: 'ALIF',
    // Only ever Catenary. Back-up screws are rare and usually their own
    // booking (mostly Mariner MIS), so they are not offered here.
    systems: ['Global BMD ALIF'],
    extras: []
  },
  deformity: {
    label: 'Deformity',
    // Richard Hannan's REline, from Nuvasive / Globus — not expected to
    // restart until about August 2027.
    systems: ['REline'],
    extras: []
  },
  removal: {
    label: 'Removal / revision',
    systems: ['TM Screw Removal'],
    extras: []
  }
}

/** What the booking's wording says the operation is. Most specific first. */
const GROUP_TESTS = [
  // Removal is the operation only when it says so. A revision or an extension
  // is still a fusion — the removal kit comes with it as an add-on (ONLY_WHEN).
  { group: 'removal', test: /\b(?:removal|remove|rem\s*o\s*s)\b/i },
  { group: 'deformity', test: /\b(?:deformity|scoliosis|kyphosis|reline)\b/i },
  { group: 'posteriorCervical', test: /\b(?:posterior\s+cervical|pcf|lateral\s+mass|c1\s*[-–/]\s*c?2|c\d\s*[-–/]\s*t\d)\b/i }
]

const ACRONYM_GROUP = {
  ACDF: 'acdf', ACCF: 'corpectomy', ALIF: 'alif', PLIF: 'plif', TLIF: 'plif',
  XLIF: 'plif', PSF: 'pedicleScrews', ADR: null, Laminectomy: null
}

/** Fixation without an interbody acronym: "T10-pelvis", "posterior fusion". */
const FIXATION = /\b(?:fixation|pedicle\s+screws?|posterior\s+(?:spinal\s+)?fusion|instrumented)\b/i
// A bare level range ("T10-pelvis") reads as fixation only when nothing else
// was recognised — "L5/S1 ALIF" is a level, not a screw construct.
const LEVEL_RANGE = /\b[tl]\d{1,2}\s*[-–/]\s*(?:[tl]\d{1,2}|s\d|pelvis|ilium)\b/i

/** The groups the operation falls in, in the order they were recognised. */
export function groupsFor(operation) {
  const text = String(operation || '')
  const out = []
  const add = g => { if (g && !out.includes(g)) out.push(g) }
  for (const { group, test } of GROUP_TESTS) if (test.test(text)) add(group)
  for (const p of findImplantProcedures(text)) add(ACRONYM_GROUP[p.acronym])
  if (!out.some(g => g === 'plif' || g === 'posteriorCervical' || g === 'deformity' || g === 'removal') && FIXATION.test(text)) add('pedicleScrews')
  if (!out.length && LEVEL_RANGE.test(text)) add('pedicleScrews')
  // "Revision L4/5 PLIF" is a PLIF that also needs the removal kit — offered
  // as an add-on, not ticked as though removal were the operation. Only a
  // booking that is nothing but a removal is a removal case.
  if (out.length > 1 && out.includes('removal')) out.splice(out.indexOf('removal'), 1)
  return out
}

/**
 * Surgeon defaults. `first` goes to the front of the group's list; `with` is
 * offered alongside as an add-on; `pick` is what a hand-entered booking has
 * ticked for it (default: the first of `first`). Hospital-specific rows beat
 * general ones.
 */
export const SURGEON_SYSTEMS = [
  { surgeon: 'JPW', group: 'acdf', first: ['Lonestar'] },
  { surgeon: 'JPW', group: 'plif', first: ['Forza XP', 'Orthofix Firebird'], pick: ['Forza XP', 'Orthofix Firebird'] },
  { surgeon: 'JPW', group: 'pedicleScrews', first: ['Orthofix Firebird'] },
  // Shoreline is Thani's back-up, so it is offered second, not ticked.
  { surgeon: 'Thani', group: 'acdf', first: ['CYLOX', 'Shoreline'] },
  { surgeon: 'Thani', group: 'corpectomy', first: [], with: ['TM Locking Distractor'] },
  { surgeon: 'Fowler', group: 'acdf', hospital: 'RHH', first: ['Dakota'] },
  { surgeon: 'Atallah', group: 'acdf', hospital: 'RHH', first: ['Dakota'] },
  { surgeon: 'Ibbett', group: 'acdf', hospital: 'CLV', first: ['Dakota'], with: ['TM Locking Distractor'], pick: ['Dakota', 'TM Locking Distractor'] },
  { surgeon: 'Dubey', group: 'posteriorCervical', first: ['Northstar'] },
  { surgeon: 'Hannan', group: 'deformity', first: ['REline'] },
  // Gupta (Brent, 4 Nov 2026): Shoreline for ACDF; Mariner MIS for most PLIF
  // and fixation, with Global BMD PLIF cages; Reform for lateral mass and C1/2.
  // Diplomat occasionally for open cases and where it is already in situ
  // (extensions), so it is offered second rather than ticked.
  { surgeon: 'Gupta', group: 'acdf', first: ['Shoreline'] },
  { surgeon: 'Gupta', group: 'plif', first: ['Mariner MIS', 'Global BMD PLIF', 'Diplomat'], pick: ['Mariner MIS', 'Global BMD PLIF'] },
  { surgeon: 'Gupta', group: 'pedicleScrews', first: ['Mariner MIS', 'Diplomat'] },
  { surgeon: 'Gupta', group: 'posteriorCervical', first: ['Reform Cervical'] }
]

function surgeonRow(surgeon, group, hospital) {
  const who = String(surgeon || '').trim().toLowerCase()
  const site = String(hospital || '').trim().toUpperCase()
  const rows = SURGEON_SYSTEMS.filter(r => r.surgeon.toLowerCase() === who && r.group === group)
  return rows.find(r => r.hospital && r.hospital === site) || rows.find(r => !r.hospital) || null
}

/**
 * The systems to offer as buttons, best first, and the extras to offer as
 * add-ons. Empty when the operation is not recognised — the screen then shows
 * every system, as it does today.
 */
// ── Narrower still (Brent, 4 Nov 2026) ──
// A pedicle-screw booking for another surgeon was offered Firebird and TM
// Screw Removal, which "is not accurate based on the info I gave you":
//
//   · Firebird (and Forza XP, which goes with it) is almost exclusively JPW's,
//     occasionally Atallah's at RHH on a JPW list. Offered for nobody else —
//     still under All systems.
//   · "TM removal should only be flagged for cases that have the words
//     extension or revision in them" (or that say removal outright). The
//     Mariner Outrigger, an extension piece, likewise only for an extension.
const ONLY_FOR = {
  'Orthofix Firebird': [{ surgeon: 'JPW' }, { surgeon: 'Atallah', hospital: 'RHH' }],
  'Forza XP': [{ surgeon: 'JPW' }, { surgeon: 'Atallah', hospital: 'RHH' }]
}
const ONLY_WHEN = {
  'TM Screw Removal': /\b(?:extension|extend(?:ed|ing)?|revision|revise|removal|remove)\b/i,
  'Mariner Outrigger': /\b(?:extension|extend(?:ed|ing)?)\b/i
}

function fits(system, { operation, surgeon, hospital }) {
  const who = ONLY_FOR[system]
  if (who && !who.some(w => w.surgeon.toLowerCase() === String(surgeon || '').trim().toLowerCase()
    && (!w.hospital || w.hospital === String(hospital || '').trim().toUpperCase()))) return false
  const when = ONLY_WHEN[system]
  return !when || when.test(String(operation || ''))
}

export function suggestSystems(input = {}) {
  const { systems, extras, picks, groups } = suggestAll(input)
  const ok = name => fits(name, input)
  return { groups, systems: systems.filter(ok), extras: extras.filter(ok), picks: picks.filter(ok) }
}

function suggestAll({ operation, surgeon, hospital } = {}) {
  const systems = []
  const extras = []
  const picks = []
  const push = (list, s) => { if (s && !list.includes(s)) list.push(s) }
  const groups = groupsFor(operation)
  for (const g of groups) {
    const row = surgeonRow(surgeon, g, hospital)
    for (const s of row?.first || []) push(systems, s)
    for (const s of row?.with || []) push(extras, s)
    // The surgeon's usual system, or the only one the operation ever takes
    // (ALIF is Catenary, deformity is REline).
    const pick = row?.pick || (row?.first?.length ? [row.first[0]] : [])
    for (const s of pick.length ? pick : SYSTEM_GROUPS[g].systems.length === 1 ? SYSTEM_GROUPS[g].systems : []) push(picks, s)
  }
  for (const g of groups) for (const s of SYSTEM_GROUPS[g].systems) push(systems, s)
  for (const g of groups) for (const s of SYSTEM_GROUPS[g].extras) push(extras, s)
  return { groups, systems, extras: extras.filter(s => !systems.includes(s)), picks }
}
