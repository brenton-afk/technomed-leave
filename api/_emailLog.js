import { saveEmailLogEntry, getEmailLog } from './_redis.js'

// ─── A record of every email the portal sends ────────────────────────────────
// "Brenton: confirm where usage emails are actually sent from (personal inboxes
// or the system), and make sure there is a record of every one sent."
//
// Both halves of that matter. The sender question is answered by the sender
// policy in _email.js; this is the record, and it covers failures as well as
// successes — "did that usage ever go?" is most often asked about one that did
// not, and an log of only the successes cannot answer it.
//
// ── What must never go in here ──
//
// The subject line of a usage email is the case folder name, and that is built
// from the patient's surname (see buildFolderName in _usageCase.js). So the
// subject is the one field that looks obviously useful and cannot be stored.
// Nor can the attachment filenames, which are the same string with a suffix.
//
// What is left still answers every question the log exists for: when, what
// kind, who sent it, who it went to, which case it belongs to, whether it
// arrived, and Resend's id for chasing it up. The case id is the link back —
// somebody who needs the patient can open the case, where the access rules
// already apply.

/** The kinds of email this app sends, named so the log can be filtered. */
export const EMAIL_KINDS = [
  'usage', 'leave', 'timesheet', 'meeting', 'pin', 'notification'
]

/**
 * Anything that looks like it came from a person's record, taken out.
 *
 * A belt-and-braces pass over the free text that reaches the log — Resend's
 * error prose can quote the subject back, and the subject carries a surname.
 * Rather than trying to recognise names, this drops the quoted fragments
 * entirely, which is the only version of this that cannot be outwitted by an
 * unusual surname.
 */
export function scrubDetail(text) {
  return String(text || '')
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'")
    .slice(0, 300)
}

/**
 * One email, recorded.
 *
 * Never throws. A log that can fail a send is worse than no log: the usage
 * going out matters more than the note that it went, and an exception here
 * would be raised after Resend had already accepted the message.
 */
export async function recordEmail({
  kind, label, sentByEmail, from, to, cc, caseId, status, messageId, detail, at
}) {
  try {
    await saveEmailLogEntry({
      id: `${Date.parse(at || new Date().toISOString())}-${Math.random().toString(36).slice(2, 8)}`,
      at: at || new Date().toISOString(),
      kind: EMAIL_KINDS.includes(kind) ? kind : 'notification',
      // Which email this was, in words with no patient in them — the callers
      // build it from the supplier, surgeon, hospital and day (never the
      // subject of a usage or booking email, which carries the surname).
      label: String(label || '').slice(0, 160),
      sentByEmail: sentByEmail || '',
      from: String(from || '').slice(0, 120),
      to: (to || []).filter(Boolean).slice(0, 12),
      cc: (cc || []).filter(Boolean).slice(0, 12),
      // The link back to the patient, rather than the patient.
      caseId: caseId || '',
      status: status === 'sent' ? 'sent' : 'failed',
      messageId: messageId || '',
      detail: status === 'sent' ? '' : scrubDetail(detail)
    })
  } catch {
    // Deliberately silent. See above.
  }
}

/** The log, newest first. */
export async function readEmailLog({ limit = 200 } = {}) {
  const entries = await getEmailLog(limit)
  return entries.sort((a, b) => String(b.at).localeCompare(String(a.at)))
}
