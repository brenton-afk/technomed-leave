// ─── An instrument off a kit for repair (Brent, 20 Nov 2026) ────────────────
// "When we take an instrument off the kit for repair, it automatically emails
// the respective departments to let them know." RHH: Kirsty, Chris, the RHH
// loans coordinator and Toby Long; Calvary: Gerardo, Brett and Julie — the
// `rhh_repairs` / `calvary_repairs` contacts in Admin → Supplier notices, so
// they can be changed there. Our clinical team is copied on both, and
// projects@ — "all instrument related enquiries emanating from the portal
// should also include projects@technomed … not in tray transfer
// correspondence though" (so kit moves do not copy it).

import { STAFF } from '../src/staffConfig.js'

export const PROJECTS_MAILBOX = 'projects@technomed.com.au'
const HOSPITAL = { RHH: 'Royal Hobart Hospital', CLV: 'Calvary Lenah Valley' }
const CONTACT = { RHH: 'rhh_repairs', CLV: 'calvary_repairs' }

/** Who an instrument repair at this hospital is sent to and copied to. */
export function repairRecipients(hospital, contacts = [], sender = {}) {
  const c = contacts.find(x => x.id === CONTACT[hospital]) || {}
  const to = [...new Set(c.to || [])]
  const lower = a => String(a).toLowerCase()
  const have = new Set(to.map(lower))
  const cc = [...new Set([
    ...(c.cc || []),
    ...STAFF.filter(s => s.isClinicalTeam).map(s => s.email),
    PROJECTS_MAILBOX,
    sender.email
  ].filter(Boolean))].filter(a => !have.has(lower(a)))
  return { to, cc, greeting: c.greeting || '' }
}

/** The email itself. Plain text; the letterhead is added by sendBookingNotice. */
export function repairEmail({ hospital, kitName, tray, line, fault, by }, contacts = [], sender = {}) {
  const { to, cc, greeting } = repairRecipients(hospital, contacts, sender)
  const item = line.description || line.code || 'Instrument'
  const subject = `Instrument for repair – ${kitName} · ${tray} · ${item}`
  const text = [
    `Hi ${greeting || 'team'},`,
    '',
    `We are taking the following instrument off the ${kitName} kit at ${HOSPITAL[hospital] || hospital} for repair.`,
    '',
    `Kit: ${kitName}`,
    `Tray: ${tray}`,
    `Instrument: ${item}${line.code && line.description ? ` (${line.code})` : ''}`,
    `Quantity: ${line.qty || 1}`,
    `Fault: ${String(fault || '').trim() || 'Not stated'}`,
    `Taken off by: ${by || 'TechnoMed'}`,
    '',
    'The tray will be one short of this instrument until it comes back from repair. We will let you know as soon as it returns.'
  ].join('\n')
  return { to, cc, subject, text }
}
