// ─── One look for every email the portal sends (Brent, 18 Nov 2026) ──────────
// "Can we make the notification emails and the usage emails (and all emails) a
// consistent template similar to the usage one? … all communications from the
// portal had clear consistency and were labeled clearly (booking, usage, loan
// set request)."
//
// The usage email's letterhead (option B, 17 Nov 2026) for all of them: the
// TechnoMed logo inline at the top left, the kind of email in teal capitals at
// the top right (NEW BOOKING, LOAN SET REQUEST, USAGE, LEAVE …), a teal rule,
// then the body — greeting, paragraphs, one panel of facts — the sign-off and
// the address. Pure: no I/O, so every email's shape is tested directly.
//
// Every value is escaped here; callers pass text, never HTML, except through
// the named HTML slots (`html` blocks), which are built from these helpers.

export const LOGO_CID = 'technomed-logo'
export const ADDRESS = 'TechnoMed Pty Ltd · 295 Elizabeth Street, North Hobart TAS 7000 · technomed.com.au'

const INK = '#23313e'
const NAVY = '#042746'
const TEAL = '#189a85'
const MUTED = '#5d6d7c'
const FAINT = '#94a1ad'

export const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A paragraph of plain text; line breaks kept. */
export const para = (text, { strong = false } = {}) =>
  `<p style="margin:0 0 12px;white-space:pre-line${strong ? `;font-weight:700;color:${NAVY}` : ''}">${esc(text)}</p>`

/** The panel of facts: label on the left, value bold on the right. Empty values left out. */
export function factsPanel(rows = []) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
  if (!shown.length) return ''
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #dbe7e4;background:#f3faf8;border-collapse:separate;border-radius:8px;margin:4px 0 16px">${
    shown.map(([k, v], i) => `<tr>
<td style="padding:7px 14px;${i < shown.length - 1 ? 'border-bottom:1px solid #e1ece9;' : ''}color:${MUTED};width:36%;font-size:13px;vertical-align:top">${esc(k)}</td>
<td style="padding:7px 14px;${i < shown.length - 1 ? 'border-bottom:1px solid #e1ece9;' : ''}color:${NAVY};font-weight:700;font-size:13px;white-space:pre-line">${esc(v)}</td></tr>`).join('')
  }</table>`
}

/** A bulleted list. */
export const bullets = items => (items || []).length
  ? `<ul style="margin:0 0 12px;padding-left:20px">${items.map(i => `<li style="margin:0 0 4px">${esc(i)}</li>`).join('')}</ul>` : ''

/** One teal button. */
export const button = (text, href) =>
  `<p style="margin:4px 0 16px"><a href="${esc(href)}" style="display:inline-block;background:${TEAL};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 22px;border-radius:8px">${esc(text)}</a></p>`

/** A small grey note. */
export const aside = text => `<p style="margin:0 0 12px;font-size:12px;color:${MUTED};white-space:pre-line">${esc(text)}</p>`

/** The sign-off: a person (name, role, contact) or the portal itself. */
export function signoff({ closing = 'Kind regards,', name = '', role = '', contact = '' } = {}) {
  if (!name) return `<div style="margin-top:22px;padding-top:14px;border-top:1px solid #e3e8ed;font-size:13px;color:${MUTED}">Sent by the TechnoMed staff portal</div>`
  return `<div style="margin-top:22px;padding-top:16px;border-top:1px solid #e3e8ed;font-size:13px;line-height:1.5;color:${MUTED}">${esc(closing)}
<div style="font-size:15px;font-weight:700;color:${NAVY}">${esc(name)}</div>
${role ? `<div style="color:${TEAL};font-weight:700">${esc(role)}</div>` : ''}
${contact ? `<div>${esc(contact)}</div>` : ''}</div>`
}

/** The same sign-off as text. */
export function signoffText({ closing = 'Kind regards,', name = '', role = '', contact = '' } = {}) {
  if (!name) return 'Sent by the TechnoMed staff portal'
  return [closing, name, role, contact].filter(Boolean).join('\n')
}

const BANNER_TONES = {
  warning: { bg: '#fff3cd', fg: '#856404' },
  danger: { bg: '#fdecea', fg: '#9b2c1f' },
  success: { bg: '#e6f4f2', fg: '#0f6f60' }
}

/**
 * The whole email around a body.
 * @param {object} o
 * @param {string} o.label   what kind of email, shown top right ("New booking")
 * @param {string} o.body    the body's HTML, built from the helpers above
 * @param {{tone,title,detail}} [o.banner] a line across the top (TEST, CORRECTION, approved …)
 */
export function emailShell({ label, body, banner = null, logoCid = LOGO_CID }) {
  const tone = BANNER_TONES[banner?.tone] || BANNER_TONES.warning
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f3f7;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center" style="padding:28px 12px;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:${INK};">
<tr><td style="padding:20px 30px 16px;border-bottom:2px solid ${TEAL};">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
<td><img src="cid:${logoCid}" alt="TechnoMed — Surgical Solutions &amp; Support" width="190" height="48" style="display:block;border:0;width:190px;height:48px"></td>
<td align="right" data-email-label style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${TEAL}">${esc(label)}</td>
</tr></table></td></tr>
${banner ? `<tr><td style="padding:12px 30px;background:${tone.bg};color:${tone.fg};font-size:13px;font-weight:700;line-height:1.5">${esc(banner.title)}${banner.detail ? `<div style="font-weight:400;margin-top:4px">${esc(banner.detail)}</div>` : ''}</td></tr>` : ''}
<tr><td style="padding:24px 30px;font-size:14px;line-height:1.6;">
${body}
<div style="font-size:11px;color:${FAINT};line-height:1.5;padding-top:14px">${esc(ADDRESS)}</div>
</td></tr></table></td></tr></table></body></html>`
}

/** The facts as text lines, for the plain-text part. */
export const factsText = rows => rows
  .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
  .map(([k, v]) => `${k}: ${v}`)

/** Plain text, every line of it, in a shell — for a draft someone edited by hand. */
export function shellFromText({ label, text, signature }) {
  const blocks = String(text || '').replace(/\r\n?/g, '\n').split(/\n{2,}/).map(b => b.trim()).filter(Boolean)
  return emailShell({ label, body: blocks.map(b => para(b)).join('') + (signature || '') })
}
