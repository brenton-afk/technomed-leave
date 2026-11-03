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
// line as tapping the button by hand. Northstar and REline are distributor
// loan sets that are not in the inventory; they are offered by name.

import { findImplantProcedures } from './procedureImplants.js'

/** Kinds of operation, each with its systems in the order they are offered. */
export const SYSTEM_GROUPS = {
  acdf: {
    label: 'ACDF',
    // Dakota is an integrated ACDF cage: RHH for Fowler and Atallah, and
    // Imogen Ibbett's at Calvary.
    systems: ['Lonestar', 'CYLOX', 'Shoreline', 'Dakota', 'Ascot'],
    extras: ['TM Locking Distractor']
  },
  corpectomy: {
    label: 'Corpectomy',
    // Expandable corpectomy: X-Core (Nuvasive) or Fortify (Globus), each with
    // that company's ACP plate. Locking Distractor occasionally, with Thani.
    systems: ['Nuvasive', 'Globus'],
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
    // Thoracolumbar fixation. Firebird is almost only JPW's, so it is listed
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
    // Richard Hannan's REline, from Nuvasive / Globus.
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
  { group: 'removal', test: /\b(?:removal|remove|revision|rem\s*o\s*s)\b/i },
  { group: 'deformity', test: /\b(?:deformity|scoliosis|kyphosis|reline)\b/i },
  { group: 'posteriorCervical', test: /\b(?:posterior\s+cervical|pcf|lateral\s+mass|c\d\s*[-–/]\s*t\d)\b/i }
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
  if (!out.some(g => g === 'plif' || g === 'posteriorCervical' || g === 'deformity') && FIXATION.test(text)) add('pedicleScrews')
  if (!out.length && LEVEL_RANGE.test(text)) add('pedicleScrews')
  return out
}

/**
 * Surgeon defaults. `first` goes to the front of the group's list; `with` is
 * offered alongside it. Hospital-specific rows beat general ones.
 */
export const SURGEON_SYSTEMS = [
  { surgeon: 'JPW', group: 'acdf', first: ['Lonestar'] },
  { surgeon: 'JPW', group: 'plif', first: ['Forza XP', 'Orthofix Firebird'] },
  { surgeon: 'JPW', group: 'pedicleScrews', first: ['Orthofix Firebird'] },
  { surgeon: 'Thani', group: 'acdf', first: ['CYLOX', 'Shoreline'] },
  { surgeon: 'Thani', group: 'corpectomy', first: [], with: ['TM Locking Distractor'] },
  { surgeon: 'Fowler', group: 'acdf', hospital: 'RHH', first: ['Dakota'] },
  { surgeon: 'Atallah', group: 'acdf', hospital: 'RHH', first: ['Dakota'] },
  { surgeon: 'Ibbett', group: 'acdf', hospital: 'CLV', first: ['Dakota'], with: ['TM Locking Distractor'] },
  { surgeon: 'Dubey', group: 'posteriorCervical', first: ['Northstar'] },
  { surgeon: 'Hannan', group: 'deformity', first: ['REline'] }
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
export function suggestSystems({ operation, surgeon, hospital } = {}) {
  const systems = []
  const extras = []
  const push = (list, s) => { if (s && !list.includes(s)) list.push(s) }
  const groups = groupsFor(operation)
  for (const g of groups) {
    const row = surgeonRow(surgeon, g, hospital)
    for (const s of row?.first || []) push(systems, s)
    for (const s of row?.with || []) push(extras, s)
  }
  for (const g of groups) for (const s of SYSTEM_GROUPS[g].systems) push(systems, s)
  for (const g of groups) for (const s of SYSTEM_GROUPS[g].extras) push(extras, s)
  return { groups, systems, extras: extras.filter(s => !systems.includes(s)) }
}
