// ─── The same usage, sent twice (Brent, 6 Nov 2026) ─────────────────────────
// Matthews, 6 Nov: one usage form scanned twice within three minutes. Each
// scan became its own case with a slightly different folder name
// ("…PLIF+Fixation+Boost-UF…" and "…PLIF+Boost-UF…"), was filed in its own
// Dropbox folder, and Device's Boost desk was emailed the usage twice —
// which reads as two grafts used and two to resupply.
//
// So before a usage goes to a distributor, this asks whether another saved
// case for the same patient on the same day has already been sent to them.
// If so that distributor is held back, with what was sent before, and goes
// only if the rep says "send it anyway". A real addition to a case already
// sent belongs in Amend, which sends a correction rather than a second usage.

const norm = s => String(s || '').trim().toLowerCase()

/**
 * For each distributor key, the earlier send of this patient's usage on this
 * day from a different case, if there is one.
 *
 * @returns {Map<string, {folderName, sentAt, from, caseId}>}
 */
export function earlierSends(record, keys, records) {
  const found = new Map()
  const surname = norm(record?.patientSurname)
  if (!surname || !record?.date) return found
  for (const other of records || []) {
    if (!other || other.id === record.id) continue
    if (norm(other.patientSurname) !== surname || other.date !== record.date) continue
    for (const sent of other.emailsSent || []) {
      if (!sent?.ok || sent.test || !keys.includes(sent.key) || found.has(sent.key)) continue
      found.set(sent.key, {
        folderName: other.folderName,
        sentAt: sent.sentAt || '',
        from: sent.from || other.repName || '',
        caseId: other.id
      })
    }
  }
  return found
}
