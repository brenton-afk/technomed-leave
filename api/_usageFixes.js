// ─── Records put right after the event ───────────────────────────────────────
// A usage record the portal saved wrong, corrected the first time it is read
// and saved back, so history, Still owed, resupply matching and the sales
// check all see the corrected case. Each fix is keyed by a SHA-256 of the
// folder name it was saved under — never the name itself, which carries the
// patient's surname — and once applied the folder name changes, so it cannot
// apply twice.
//
// Brent, 9 Nov 2026: a case read with patient and surgeon the wrong way round
// and filed under a new surgeon folder named after the patient. The Dropbox
// folder was moved and renamed by hand the same day; this puts the record in
// step with it.

import { createHash } from 'node:crypto'
import { buildFolderName } from './_usageCase.js'

const FIXES = {
  '3fc8ee85bee195f392feb1e05ec0a451551b2616e1202a93f02fc2a9dc7ce782': 'swapPatientSurgeon'
}

const hash = s => createHash('sha256').update(String(s || '')).digest('hex')

function swapPatientSurgeon(r) {
  const patientSurname = r.surgeonSurname
  const surgeonSurname = r.patientSurname
  const oldFolder = r.folderName
  const folderName = buildFolderName({ patientSurname, date: r.date, surgeonSurname, procedure: r.procedure, hospital: r.hospital, items: r.items || [] })
  const dropboxPath = String(r.dropboxPath || '')
    .split('/')
    .map(seg => (seg === oldFolder ? folderName : seg === r.surgeonSurname ? surgeonSurname : seg))
    .join('/')
  return {
    ...r,
    patientSurname,
    surgeonSurname,
    surgeonName: surgeonSurname,
    folderName,
    dropboxPath,
    filesSaved: (r.filesSaved || []).map(f => String(f).split(oldFolder).join(folderName)),
    fixedAt: new Date().toISOString(),
    fix: 'patient and surgeon swapped back'
  }
}

/** The record as it should be, and whether it changed. */
export function applyUsageFix(record, fixes = FIXES) {
  const kind = record && fixes[hash(record.folderName)]
  if (kind === 'swapPatientSurgeon') return { record: swapPatientSurgeon(record), changed: true }
  return { record, changed: false }
}

export const folderHash = hash
