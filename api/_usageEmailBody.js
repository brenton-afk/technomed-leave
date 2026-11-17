// ─── The usage email's words (Brent, 17 Nov 2026) ────────────────────────────
// "Personalise the message that gets sent with usages both from an addressee
// point of view and also from the person sending it … a TechnoMed logo …
// the email signature of the person sending." He chose option B of the
// mock-ups (claude.ai/artifact/KLFYtSx7me31Z5KwSrDgFg): the logo as letterhead,
// "Hi {greeting}," then one panel of case facts, the rep's own note if they
// typed one, and their signature.
//
// Pure: no I/O, so the layout is tested directly (usageEmailBody.test.js).
// The patient is never in the body. The subject (the case folder name) and
// the attachments carry the surname, as before; the panel says surgeon,
// hospital, date, the distributor's systems and the item count.

import { findSystems } from '../src/clinicalPlan/systems.js'
import { STAFF } from '../src/staffConfig.js'

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** How each distributor's email opens: "Hi {greeting},". Edited in Admin → Supplier notices. */
export const DEFAULT_USAGE_GREETINGS = {
  signus: 'Jasper and Amanda',
  e4: 'Roy and the E4 team',
  device: 'Device Ortho & Spine team',
  device_boost: 'Device team',
  kt: 'Ben and the KT team',
  globus: 'Globus team',
  dtbv: 'DTBV team'
}

const MAKER_ONLY = /^(e4|signus|kt|device|globus|nuvasive)$/i
const HOSPITALS = { CLV: 'Calvary', RHH: 'Royal Hobart Hospital' }
const NOTE_MAX = 600

/** The greeting for a distributor, from the saved ones, else the default, else their name. */
export function greetingFor(key, saved = {}, fallbackName = '') {
  const g = String(saved?.[key] ?? DEFAULT_USAGE_GREETINGS[key] ?? '').trim()
  return g || (fallbackName ? `${fallbackName} team` : 'team')
}

/** A typed note, tidied: plain text, trimmed, capped. */
export function cleanNote(note) {
  return String(note || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, NOTE_MAX)
}

/** "Tue 17 Nov 2026" from YYYY-MM-DD, without the device's timezone. */
export function surgeryDay(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''))
  if (!m) return ''
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** The case facts the panel shows. Never the patient. */
export function caseFacts(record = {}, items = []) {
  // Per line: "E4 SURGICAL DAKOTA screw" names the maker and the system, and
  // "E4" alone also matches E4 Cages — a maker's name counts only when the
  // line names nothing more specific.
  const systems = [...new Set(items.flatMap(i => {
    const found = findSystems(String(i?.productName || ''))
    const specific = found.filter(f => !MAKER_ONLY.test(f.matched))
    return (specific.length ? specific : found).map(f => f.name)
  }))]
  const lines = items.length
  const stocks = [...new Set(items.map(i => String(i?.stock || '')).filter(Boolean))]
  const stock = stocks.length === 1 ? (stocks[0] === 'Loan' ? 'loan' : 'consignment') : ''
  return [
    ['Surgeon', String(record.surgeonSurname || record.surgeonName || '').trim()],
    ['Hospital', HOSPITALS[record.hospital] || String(record.hospital || '').trim()],
    ['Date of surgery', surgeryDay(record.date)],
    ['Your systems', systems.join(' · ')],
    ['Items', lines ? `${lines} line${lines === 1 ? '' : 's'}${stock ? ` · ${stock}` : ''}` : '']
  ].filter(([, v]) => v)
}

/** The sender's sign-off, from the staff list. */
export function signoffFor(sender = {}) {
  const staff = STAFF.find(s => s.email.toLowerCase() === String(sender.email || '').toLowerCase())
  return {
    name: staff?.name || String(sender.name || '').trim() || 'TechnoMed',
    role: staff?.role || '',
    contact: [staff?.phone, staff?.email || sender.email].filter(Boolean).join(' · ')
  }
}

const ADDRESS = 'TechnoMed Pty Ltd · 295 Elizabeth Street, North Hobart TAS 7000 · technomed.com.au'

/**
 * The email, html and text. `logoCid` is the inline logo's content id.
 * `banner` is the TEST or CORRECTION line, already worded by the caller.
 */
export function usageEmailContent({
  greeting, record = {}, items = [], note = '', sender = {}, scanAttached = false,
  logoCid = 'technomed-logo', banner = null, correctionText = ''
}) {
  const facts = caseFacts(record, items)
  const sig = signoffFor(sender)
  const typed = cleanNote(note)
  const lead = correctionText
    ? ''
    : (scanAttached
      ? 'Here’s the usage from the case below. The usage sheet and the signed hospital form are attached.'
      : 'Here’s the usage from the case below. The usage sheet is attached.')
  const close = 'Any questions, reply here and it comes straight to me.'

  const factRows = facts.map(([k, v]) => `<tr>
<td style="padding:7px 14px;border-bottom:1px solid #e1ece9;color:#5d6d7c;width:34%;white-space:nowrap;font-size:13px">${escapeHtml(k)}</td>
<td style="padding:7px 14px;border-bottom:1px solid #e1ece9;color:#042746;font-weight:700;font-size:13px">${escapeHtml(v)}</td></tr>`).join('')

  const bannerHtml = banner
    ? `<tr><td style="padding:12px 30px;background:${banner.tone === 'danger' ? '#fdecea' : '#fff3cd'};color:${banner.tone === 'danger' ? '#9b2c1f' : '#856404'};font-size:13px;font-weight:700;line-height:1.5">${escapeHtml(banner.title)}${banner.detail ? `<div style="font-weight:400;margin-top:4px">${escapeHtml(banner.detail)}</div>` : ''}</td></tr>`
    : ''

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f3f7;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center" style="padding:28px 12px;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#23313e;">
<tr><td style="padding:20px 30px 16px;border-bottom:2px solid #189a85;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
<td><img src="cid:${logoCid}" alt="TechnoMed — Surgical Solutions &amp; Support" width="190" height="48" style="display:block;border:0;width:190px;height:48px"></td>
<td align="right" style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#189a85">${correctionText ? 'Usage correction' : 'Usage'}</td>
</tr></table></td></tr>
${bannerHtml}
<tr><td style="padding:24px 30px;font-size:14px;line-height:1.6;">
<p style="margin:0 0 12px">Hi ${escapeHtml(greeting)},</p>
${correctionText ? `<p style="margin:0 0 12px;font-weight:700">${escapeHtml(correctionText)}</p>` : `<p style="margin:0 0 12px">${escapeHtml(lead)}</p>`}
${facts.length ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #dbe7e4;background:#f3faf8;border-collapse:separate;border-radius:8px;margin:4px 0 16px">${factRows}</table>` : ''}
${typed ? `<p style="margin:0 0 12px;white-space:pre-line">${escapeHtml(typed)}</p>` : ''}
<p style="margin:0 0 12px">${escapeHtml(close)}</p>
<div style="margin-top:22px;padding-top:16px;border-top:1px solid #e3e8ed;font-size:13px;line-height:1.5;color:#5d6d7c">
Thanks,<div style="font-size:15px;font-weight:700;color:#042746">${escapeHtml(sig.name)}</div>
${sig.role ? `<div style="color:#189a85;font-weight:700">${escapeHtml(sig.role)}</div>` : ''}
${sig.contact ? `<div>${escapeHtml(sig.contact)}</div>` : ''}
</div>
<div style="font-size:11px;color:#94a1ad;line-height:1.5;padding-top:14px">${escapeHtml(ADDRESS)}</div>
</td></tr></table></td></tr></table></body></html>`

  const text = [
    banner ? `${banner.title}${banner.detail ? ` ${banner.detail}` : ''}\n` : '',
    `Hi ${greeting},`,
    '',
    correctionText || lead,
    '',
    ...facts.map(([k, v]) => `${k}: ${v}`),
    ...(typed ? ['', typed] : []),
    '',
    close,
    '',
    'Thanks,',
    sig.name,
    ...(sig.role ? [sig.role] : []),
    ...(sig.contact ? [sig.contact] : []),
    '',
    ADDRESS
  ].join('\n').replace(/^\n+/, '')

  return { html, text }
}
