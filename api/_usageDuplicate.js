// ─── Is this case already filed? (Brent, 6 Nov 2026) ─────────────────────────
// "Make sure these errors don't continue … a check should be 'is there
// already a folder in Dropbox?' That would prompt the portal to not double it
// up, especially if the patient, graft number and the scans are identical."
//
// Matthews: one form scanned twice. The second read the procedure a word
// shorter, so it got its own folder name, its own Dropbox folder, and Boost
// was emailed again — and Device have before resupplied twice when they could
// not tell a double-up from a second usage.
//
// So before anything is filed, a scan is checked against what is already
// filed for that patient on that day — the portal's own records and the
// Dropbox case folders by name — and the items are compared by what
// identifies an implant: code, lot (a graft's number) and quantity.
//
//   · identical, or nothing new  → not filed, not sent. "Already filed."
//   · something new on it        → not filed; Amend the earlier case, which
//                                   sends a correction rather than a usage.
//   · a folder with no record    → filed only once the rep confirms.
//
// The rep can still say "this is a different case" (two operations on one
// patient on one day happen), which files it — under a name that can never
// land in, or overwrite, the earlier folder.

const norm = s => String(s || '').trim().toLowerCase()
const code = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** What identifies one implant line: its code (else its name), its lot, and how many. */
export function itemKey(item) {
  const what = code(item.referenceCode) || norm(item.productName || item.description)
  return `${what}|${code(item.lotNumber)}`
}

function tally(items) {
  const counts = new Map()
  for (const i of items || []) {
    if (i.excluded) continue
    const k = itemKey(i)
    counts.set(k, (counts.get(k) || 0) + (Number(i.quantity) || 1))
  }
  return counts
}

/** Lines on the new scan that the earlier case does not already account for. */
export function newLines(items, earlierItems) {
  const before = tally(earlierItems)
  const out = []
  for (const item of items || []) {
    if (item.excluded) continue
    const k = itemKey(item)
    const had = before.get(k) || 0
    const want = Number(item.quantity) || 1
    if (want > had) out.push({ ...item, quantity: want - had })
    before.set(k, Math.max(0, had - want))
  }
  return out
}

/**
 * The earlier filing this scan duplicates, if any.
 *
 * @param record   the case about to be saved
 * @param records  saved usage records (recent)
 * @param folders  Dropbox case-folder names for this patient and day
 * @returns null, or { kind: 'identical' | 'adds' | 'folder', earlier, added }
 */
export function findDuplicate(record, records, folders = []) {
  const surname = norm(record?.patientSurname)
  if (!surname || !record?.date) return null
  const same = (records || []).filter(r => r && r.id !== record.id
    && norm(r.patientSurname) === surname && r.date === record.date)
  if (same.length) {
    // The earlier case that best covers this scan.
    const ranked = same
      .map(r => ({ r, added: newLines(record.items, r.items) }))
      .sort((a, b) => a.added.length - b.added.length)
    const { r, added } = ranked[0]
    return {
      kind: added.length ? 'adds' : 'identical',
      earlier: {
        id: r.id, folderName: r.folderName, by: r.repName || '', at: r.createdAt || '',
        sentTo: (r.emailsSent || []).filter(e => e.ok && !e.test).map(e => e.name)
      },
      added
    }
  }
  // A folder of exactly this name with no record behind it is this same save,
  // filed to Dropbox on an earlier attempt that failed before recording —
  // retrying it must not be blocked. Any other name for the day is a case.
  const own = norm(record.folderName)
  const other = folders.find(f => norm(f) !== own)
  if (other) return { kind: 'folder', earlier: { folderName: other }, added: [] }
  return null
}

/** A folder name that cannot be an existing one: "…_CLV", then "…_CLV_2", "…_CLV_3". */
export function freeFolderName(name, taken = []) {
  const used = new Set(taken.map(norm))
  if (!used.has(norm(name))) return name
  let n = 2
  while (used.has(norm(`${name}_${n}`))) n += 1
  return `${name}_${n}`
}
