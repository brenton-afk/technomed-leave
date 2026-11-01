import { STAFF, leaveApprovers } from '../src/staffConfig.js'
import { recordEmail } from './_emailLog.js'

const LEAVE_LABELS = {
  'ANNUAL_LEAVE': 'Annual Leave',
  'SICK': 'Personal / Sick Leave',
  'TOIL': 'Time Off In Lieu (TOIL)'
}

const VARIANTS = {
  submitted: { heading: 'Leave Application', badge: '#e6f4f2', badgeText: '#1a7a6e', banner: null },
  approved: {
    heading: 'Leave Approved',
    badge: '#e6f4f2',
    badgeText: '#1a7a6e',
    banner: { bg: '#e6f4f2', text: '#1a7a6e', label: '✅ This leave has been approved.' }
  },
  declined: {
    heading: 'Leave Declined',
    badge: '#fdecea',
    badgeText: '#c0392b',
    banner: { bg: '#fdecea', text: '#c0392b', label: '❌ This leave request was declined.' }
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Who sees a leave application.
 *
 * Derived from the roster rather than read from EMAIL_TO_1..3, because those
 * are environment variables that *override* the defaults written here. The
 * code said Erin and Brenton all along; production said whatever was typed
 * into Vercel months ago, and the two had quietly diverged — which is how an
 * application can be submitted, recorded, acknowledged, and never reach the
 * person who approves it.
 *
 * isAdmin on the roster is already exactly Brenton and Erin, and it is the
 * same flag that gates the admin portal where leave is approved. One fact,
 * one place: adding an approver means adding them to the roster, and they get
 * the mail and the screen together rather than one without the other.
 *
 * The environment can still add — a forwarding address, a shared inbox — but
 * it can no longer remove. Nobody responsible for approving leave should be
 * droppable by an env var nobody can read back.
 */
export function adminRecipients() {
  const fromRoster = STAFF.filter(s => s.isAdmin).map(s => s.email)
  const extra = [process.env.EMAIL_TO_1, process.env.EMAIL_TO_2, process.env.EMAIL_TO_3]
    .filter(Boolean)
  const seen = new Set()
  return [...fromRoster, ...extra].filter(address => {
    const key = String(address).trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Applications submitted before `email` was persisted fall back to the roster.
function employeeEmail(application) {
  if (application.email) return application.email
  return STAFF.find(s => s.name === application.name)?.email || null
}

function buildEmailHtml(application, variant, declineReason) {
  const { name, division, startDate, endDate, returnDate, leaveType, reason } = application
  const v = VARIANTS[variant]
  const leaveLabel = LEAVE_LABELS[leaveType] || leaveType

  const rows = [
    ['Employee', name],
    ['Division', division],
    ['First day', formatDate(startDate)],
    ['Last day', formatDate(endDate)],
    ['Return date', formatDate(returnDate)],
    // Part-time staff: the hours, day by day, which is what Xero is sent.
    ...(application.totalHours ? [['Hours', `${application.totalHours}h — `
      + (application.hours || []).map(d => `${formatDate(d.date)} ${d.hours}h`).join(', ')]] : []),
    ['Reason', reason]
  ]
  if (variant === 'declined' && declineReason) rows.push(['Decline reason', declineReason])

  const rowHtml = rows.map(([label, value], i) => `
  <tr${i % 2 === 0 ? ' style="background:#f8f9fc;"' : ''}><td style="padding:11px 14px;font-size:12px;color:#6b7a8d;width:140px;">${escapeHtml(label)}</td><td style="padding:11px 14px;font-size:13px;color:#1a2b4a;font-weight:500;">${escapeHtml(value)}</td></tr>`).join('')

  const bannerHtml = v.banner ? `
  <tr><td style="padding:0 32px 4px;">
  <div style="background:${v.banner.bg};color:${v.banner.text};padding:12px 14px;border-radius:10px;font-size:13px;font-weight:600;">${v.banner.label}</div>
  </td></tr>` : ''

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f3f7;font-family:-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
  <table width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr><td style="background:#1a2b4a;padding:28px 32px;">
  <div style="font-size:22px;font-weight:700;color:#ffffff;">${v.heading}</div>
  <div style="font-size:13px;color:rgba(255,255,255,0.55);margin-top:4px;">TechnoMed Staff Portal</div>
  </td></tr>
  <tr><td style="padding:24px 32px 0;">
  <span style="background:${v.badge};color:${v.badgeText};padding:5px 14px;border-radius:20px;font-size:13px;font-weight:600;">${escapeHtml(leaveLabel)}</span>
  </td></tr>${bannerHtml}
  <tr><td style="padding:20px 32px;">
  <table width="100%" style="border:1px solid rgba(26,43,74,0.1);border-radius:10px;overflow:hidden;">${rowHtml}
  </table></td></tr>${variant === 'submitted' ? `
  <tr><td style="padding:0 32px 24px;" align="center">
  <a href="${APPROVE_URL}" style="display:inline-block;background:#189a85;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:10px;">Approve or decline</a>
  </td></tr>` : ''}
  <tr><td style="padding:0 32px 24px;font-size:11px;color:#aab0bb;text-align:center;">TechnoMed Leave Portal · technomed.com.au</td></tr>
  </table></td></tr></table>
  </body></html>`
}

// ─── Who an email comes from ─────────────────────────────────────────────────
// Rewritten after every outgoing email failed in production with a Resend 403.
// Two faults, and only one of them was a bug:
//
//   · EMAIL_FROM pointed at Resend's test address, which can only ever deliver
//     to the Resend account's own owner. Every leave email to anybody else was
//     refused. That is configuration, and the fix is in Vercel, not here.
//
//   · A rejected sender was quietly retried as the fallback and reported as
//     success. That was written as a kindness — "the usage still goes out" —
//     and it was the wrong call. Toni: "distributors must be able to reply
//     directly to a usage email, so a noreply sender is not acceptable." A send
//     that silently becomes something the recipient cannot reply to has not
//     succeeded; it has failed quietly, which is worse, because nobody knows to
//     go and fix it. It is gone.
//
// technomed.com.au is a verified domain in Resend now, so a rep's own address
// is a legitimate sender and a distributor hitting reply reaches the person who
// was in the theatre. That is the whole point, and it needs no Reply-To.

const VERIFIED_DOMAIN = /@technomed\.com\.au\s*>?\s*$/i

/** Resend's test addresses, which deliver to one inbox and look like a bug. */
const TEST_ADDRESS = /@resend\.dev/i

/**
 * An email that did not send.
 *
 * `message` is what a person reads, and is deliberately the same short sentence
 * every time. Every existing caller already shows `err.message` to staff, so
 * making the friendly line the message is what keeps raw Resend JSON off a
 * phone screen without having to touch eight call sites.
 *
 * `detail` is the technical cause. It goes to the server log and the sent-email
 * log, and nowhere near a user.
 */
export class EmailNotSent extends Error {
  constructor(detail) {
    super('Email not sent — please contact Brenton.')
    this.name = 'EmailNotSent'
    this.detail = String(detail || '')
  }
}

/**
 * The address an email is sent from.
 *
 * A staff member on the verified domain sends as themselves. Everything else —
 * leave decisions, timesheet notices, meeting minutes — comes from the portal,
 * at whatever EMAIL_FROM names.
 */
export function fromAddress(sender) {
  if (sender?.email && VERIFIED_DOMAIN.test(sender.email)) {
    // Stripped of the characters that would end the display name early and let
    // the rest of it be read as an address of its own.
    const name = String(sender.name || '').replace(/[<>"@,;]/g, '').trim()
    return name ? `${name} <${sender.email}>` : sender.email
  }

  const configured = String(process.env.EMAIL_FROM || '').trim()
  if (!configured) {
    throw new EmailNotSent('EMAIL_FROM is not set. Set it to an address on the '
      + 'verified domain, e.g. "TechnoMed Portal <portal@technomed.com.au>".')
  }
  // Caught here rather than at Resend, because the message Resend gives for it
  // ("you can only send testing emails to your own email address") reads like a
  // broken feature rather than a setting nobody has updated.
  if (TEST_ADDRESS.test(configured)) {
    throw new EmailNotSent(`EMAIL_FROM is ${configured}, which is Resend's test `
      + 'address and can only deliver to the Resend account owner. Set it to an '
      + 'address on technomed.com.au.')
  }
  return configured
}

async function send({
  to, cc, subject, html, text, attachments, sender, replyTo, kind, caseId
}) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new EmailNotSent('RESEND_API_KEY not configured')

  const recipients = (to || []).filter(Boolean)
  if (recipients.length === 0) throw new EmailNotSent('No recipients for email')

  const from = fromAddress(sender)
  const copies = (cc || []).filter(Boolean)

  const payload = { from, to: recipients, subject, html, text }
  if (replyTo) payload.reply_to = replyTo
  if (copies.length) payload.cc = copies
  if (attachments?.length) payload.attachments = attachments

  const note = (status, extra) => recordEmail({
    kind,
    sentByEmail: sender?.email,
    from,
    to: recipients,
    cc: copies,
    caseId,
    status,
    ...extra
  })

  let res
  let body = ''
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    body = await res.text()
  } catch (err) {
    const failure = new EmailNotSent(`Could not reach Resend: ${err.message}`)
    await note('failed', { detail: failure.detail })
    throw failure
  }

  if (!res.ok) {
    const failure = new EmailNotSent(`Resend ${res.status}: ${body.slice(0, 300)}`)
    // Recorded before it is thrown, so a failure is on the record even though
    // the caller is about to turn this into one line on a screen.
    await note('failed', { detail: failure.detail })
    // The cause, where somebody reading a server log can act on it. Never the
    // patient: the subject carries a surname, so the subject is not in here.
    console.error(`Email failed (${kind || 'unknown'}): Resend ${res.status}`)
    throw failure
  }

  let messageId = ''
  try {
    messageId = JSON.parse(body)?.id || ''
  } catch {
    // Resend accepted it; an unparseable body costs us the id and nothing else.
  }

  await note('sent', { messageId })
  return { sent: true, recipients, from, messageId }
}

function summaryText(application, prefix, extra = '') {
  const leaveLabel = LEAVE_LABELS[application.leaveType] || application.leaveType
  return `${prefix}\nEmployee: ${application.name}\nLeave type: ${leaveLabel}\nDivision: ${application.division}\nFrom: ${application.startDate}\nTo: ${application.endDate}\nReturn: ${application.returnDate}\nReason: ${application.reason}${extra}`
}

/** Where the approver lands from the email: Admin → Leave. */
export const APPROVE_URL = 'https://leave.technomed.com.au/?go=approvals'

// Sent to the approver (Erin) when a new application is lodged. Only her:
// "Erin is the only approver so email can go to her when a leave application
// is placed." It used to go to every admin, which is two people each assuming
// the other had it.
export async function sendNotificationEmail(application) {
  const leaveLabel = LEAVE_LABELS[application.leaveType] || application.leaveType
  const approvers = leaveApprovers()
  return send({
    kind: 'leave',
    to: approvers.length ? approvers : adminRecipients(),
    subject: `Leave to approve — ${application.name} (${leaveLabel})`,
    html: buildEmailHtml(application, 'submitted'),
    text: summaryText(application, `New leave application from ${application.name}`,
      `\n\nApprove or decline: ${APPROVE_URL}`)
  })
}

// Sent to the employee (cc approvers) once an application is approved.
export async function sendApprovalEmail(application) {
  const leaveLabel = LEAVE_LABELS[application.leaveType] || application.leaveType
  return send({
    kind: 'leave',
    to: [employeeEmail(application), ...adminRecipients()],
    subject: `Leave Approved — ${application.name} (${leaveLabel})`,
    html: buildEmailHtml(application, 'approved'),
    text: summaryText(application, `Leave approved for ${application.name}`)
  })
}

// Sent to the employee (cc approvers) when an application is declined.
export async function sendDeclineEmail(application, declineReason = '') {
  const leaveLabel = LEAVE_LABELS[application.leaveType] || application.leaveType
  return send({
    kind: 'leave',
    to: [employeeEmail(application), ...adminRecipients()],
    subject: `Leave Declined — ${application.name} (${leaveLabel})`,
    html: buildEmailHtml(application, 'declined', declineReason),
    text: summaryText(
      application,
      `Leave declined for ${application.name}`,
      declineReason ? `\nDecline reason: ${declineReason}` : ''
    )
  })
}

// ─── PIN RESET REQUESTS ────────────────────────────────────

// Sent when someone taps "I don't know my PIN". Grants nothing — it just tells
// the admins to clear it, so a locked-out staff member is not a dead end.
export async function sendPinResetRequestEmail(staff) {
  const approvers = ['brenton@technomed.com.au', 'erin@technomed.com.au']
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f3f7;font-family:-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
  <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr><td style="background:#042746;padding:26px 30px;">
  <div style="font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;">Staff Portal</div>
  <div style="font-size:19px;font-weight:700;color:#ffffff;">PIN reset requested</div>
  </td></tr>
  <tr><td style="padding:24px 30px;font-size:14px;color:#042746;line-height:1.65;">
  <strong>${escapeHtml(staff.name)}</strong> can't sign in and has asked for their PIN to be reset.
  <div style="margin-top:16px;padding:14px 16px;background:#f8f9fc;border-radius:10px;font-size:13px;color:#6b7a8d;line-height:1.6;">
  Open the portal → <strong style="color:#042746;">Admin</strong> → <strong style="color:#042746;">Staff PINs</strong> →
  ${escapeHtml(staff.name.split(' ')[0])} → <strong style="color:#042746;">Reset PIN</strong>.<br>
  They'll then be able to create a new one next time they sign in.
  </div>
  </td></tr>
  <tr><td style="padding:0 30px 24px;font-size:11px;color:#aab0bb;text-align:center;">TechnoMed Staff Portal · technomed.com.au</td></tr>
  </table></td></tr></table>
  </body></html>`

  return send({
    kind: 'pin',
    to: approvers,
    subject: `PIN reset requested — ${staff.name}`,
    html,
    text: `${staff.name} cannot sign in and has requested a PIN reset.\n\nAdmin → Staff PINs → ${staff.name} → Reset PIN.`
  })
}

// ─── TIMESHEETS ────────────────────────────────────────────

const TIMESHEET_APPROVERS = ['brenton@technomed.com.au', 'erin@technomed.com.au']

function timesheetSummaryRows(record) {
  const t = record.totals || {}
  return [
    ['Staff', record.staffName],
    ['Pay period', `${formatDate(record.periodStart)} — ${formatDate(record.periodEnd)}`],
    ['Total hours', `${t.totalHours ?? 0}`],
    ['Week 1 / Week 2', `${t.weekHours?.[0] ?? 0}h / ${t.weekHours?.[1] ?? 0}h`],
    ...(t.callouts ? [['Call-ins', `${t.callouts}`]] : [])
  ]
}

function timesheetHtml({ heading, banner, record, extraRows = [] }) {
  const rows = [...timesheetSummaryRows(record), ...extraRows].map(([label, value], i) => `
  <tr${i % 2 === 0 ? ' style="background:#f8f9fc;"' : ''}><td style="padding:11px 14px;font-size:12px;color:#6b7a8d;width:150px;">${escapeHtml(label)}</td><td style="padding:11px 14px;font-size:13px;color:#1a2b4a;font-weight:500;">${escapeHtml(value)}</td></tr>`).join('')

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f3f7;font-family:-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
  <table width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr><td style="background:#042746;padding:26px 30px;">
  <div style="font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;">Timesheet</div>
  <div style="font-size:19px;font-weight:700;color:#ffffff;">${escapeHtml(heading)}</div>
  </td></tr>
  ${banner ? `<tr><td style="padding:20px 30px 0;"><div style="background:${banner.bg};color:${banner.fg};padding:12px 14px;border-radius:10px;font-size:13px;font-weight:600;">${escapeHtml(banner.text)}</div></td></tr>` : ''}
  <tr><td style="padding:20px 30px;">
  <table width="100%" style="border:1px solid rgba(26,43,74,0.1);border-radius:10px;overflow:hidden;">${rows}</table>
  </td></tr>
  <tr><td style="padding:0 30px 24px;font-size:11px;color:#aab0bb;text-align:center;">TechnoMed Staff Portal · technomed.com.au</td></tr>
  </table></td></tr></table>
  </body></html>`
}

export async function sendTimesheetSubmittedEmail(record) {
  return send({
    kind: 'timesheet',
    to: TIMESHEET_APPROVERS,
    subject: `Timesheet submitted — ${record.staffName} (${record.periodStart} to ${record.periodEnd})`,
    html: timesheetHtml({ heading: 'Timesheet submitted for approval', record }),
    text: `${record.staffName} submitted a timesheet for ${record.periodStart} to ${record.periodEnd}.\nTotal hours: ${record.totals?.totalHours ?? 0}\nApprove it in the Admin portal.`
  })
}

export async function sendTimesheetDecisionEmail(record, decision, reason = '') {
  const approved = decision === 'approved'
  return send({
    kind: 'timesheet',
    to: [record.email, ...TIMESHEET_APPROVERS],
    subject: `Timesheet ${approved ? 'approved' : 'returned'} — ${record.periodStart} to ${record.periodEnd}`,
    html: timesheetHtml({
      heading: approved ? 'Timesheet approved' : 'Timesheet returned for changes',
      banner: approved
        ? { bg: '#e6f4f2', fg: '#189a85', text: '✅ Approved and sent to Xero for the pay run.' }
        : { bg: '#fdecea', fg: '#c0392b', text: '❌ Returned — please correct and resubmit.' },
      record,
      extraRows: !approved && reason ? [['Reason', reason]] : []
    }),
    text: approved
      ? `Your timesheet for ${record.periodStart} to ${record.periodEnd} has been approved.`
      : `Your timesheet for ${record.periodStart} to ${record.periodEnd} was returned.\nReason: ${reason || 'no reason given'}`
  })
}

// ─── SURGEON USAGE ─────────────────────────────────────────

// One email per distributor, carrying only that distributor's items. The
// subject is the case folder name so the distributor's filing matches ours.
// Deliberately plain: distributors reconcile from the attachment, and the body
// must not carry patient identifiers to an external party.
/**
 * @param {object} o
 * @param {Buffer} o.xlsx            the distributor's own items
 * @param {Buffer} [o.scanPdf]       the scanned form, all pages merged into one
 * @param {string} [o.scanPdfFilename]
 */
export async function sendUsageEmail({
  to, cc, subject, distributorLabel, xlsx, xlsxFilename,
  scanPdf, scanPdfFilename, test, sender, caseId
}) {
  // A test send goes to the person testing and nowhere else, and has to be
  // impossible to mistake for the real thing — in the inbox list, in the subject,
  // and at the top of the body. Someone forwarding one on by accident is the
  // failure being designed against.
  const body = test
    ? 'This is a test. Nothing has been sent to the distributor. The attachments are '
      + 'the ones that would have gone to them.'
    : (scanPdf
      ? 'Please find the usage sheet and a scan of the signed form attached.'
      : 'Please find usage attached.')
  const signoff = 'Warm regards,<br>TechnoMed'
  const heading = test ? `[TEST] ${subject}` : subject
  const wouldHaveGone = test && to.length
    ? `Would have gone to: ${test.wouldSendTo.join(', ')}`
    : ''

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f3f7;font-family:-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
  <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr><td style="background:#042746;padding:24px 28px;">
  <div style="font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;">${test ? 'Usage · test' : 'Usage'}</div>
  <div style="font-size:17px;font-weight:700;color:#ffffff;">${escapeHtml(heading)}</div>
  ${distributorLabel ? `<div style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:4px;">${escapeHtml(distributorLabel)}</div>` : ''}
  </td></tr>
  ${test ? `<tr><td style="padding:14px 28px;background:#fff3cd;color:#856404;font-size:13px;font-weight:700;line-height:1.5;">
  TEST — not sent to the distributor${wouldHaveGone ? `<div style="font-weight:400;margin-top:4px;">${escapeHtml(wouldHaveGone)}</div>` : ''}
  </td></tr>` : ''}
  <tr><td style="padding:24px 28px;font-size:14px;color:#042746;line-height:1.6;">
  ${escapeHtml(body)}<div style="margin-top:16px;color:#6b7a8d;font-size:13px;">${signoff}</div>
  </td></tr>
  <tr><td style="padding:0 28px 22px;font-size:11px;color:#aab0bb;text-align:center;">TechnoMed · technomed.com.au</td></tr>
  </table></td></tr></table>
  </body></html>`

  return send({
    to,
    cc,
    kind: 'usage',
    caseId,
    subject: heading,
    html,
    text: `${test ? `TEST — not sent to the distributor. ${wouldHaveGone}\n\n` : ''}${body}\n\nWarm regards,\nTechnoMed`,
    attachments: [
      { filename: xlsxFilename, content: xlsx.toString('base64') },
      // The scanned form, where the pages were supplied. Most distributors need
      // the signed original for traceability, not only the transcription of it.
      ...(scanPdf ? [{ filename: scanPdfFilename || 'Scan.pdf', content: scanPdf.toString('base64') }] : [])
    ],
    // From the rep who scanned it, so a distributor replying reaches the person
    // who was in the theatre rather than a shared inbox. Reply-To is kept as
    // well: it costs nothing, and it still carries the rep in the one case
    // where the sender is somehow not on the verified domain.
    sender,
    replyTo: sender?.email
  })
}

// ─── MEETING MINUTES / ACTION ITEMS ────────────────────────

const PRIORITY_COLORS = { urgent: '#c0392b', normal: '#1a7a6e', low: '#6b7a8d' }
const PRIORITY_LABELS = { urgent: 'Urgent', normal: 'Normal', low: 'Low' }

// Every interpolated value here is plain text by contract: the meeting title is
// typed by staff, and the summary / task / notes come back from the transcript
// analysis, which is prompted for prose and never markup.
function buildMeetingEmailHtml(staff, meeting, myItems) {
  const itemsHtml = myItems.length
    ? myItems.map(it => `
      <tr><td style="padding:11px 14px;border-bottom:1px solid rgba(26,43,74,0.06);">
        <div style="font-size:13px;font-weight:600;color:#1a2b4a;">${escapeHtml(it.task)}</div>
        <div style="font-size:11px;margin-top:3px;">
          <span style="color:${PRIORITY_COLORS[it.priority] || '#6b7a8d'};font-weight:600;text-transform:uppercase;letter-spacing:0.3px;">${escapeHtml(PRIORITY_LABELS[it.priority] || it.priority)}</span>
          ${it.due_date ? `<span style="color:#6b7a8d;"> · Due ${escapeHtml(formatDate(it.due_date))}</span>` : ''}
        </div>
        ${it.notes ? `<div style="font-size:12px;color:#6b7a8d;margin-top:5px;line-height:1.5;">${escapeHtml(it.notes)}</div>` : ''}
      </td></tr>`).join('')
    : `<tr><td style="padding:20px 14px;font-size:13px;color:#6b7a8d;text-align:center;">No action items assigned to you from this meeting.</td></tr>`

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f3f7;font-family:-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
  <table width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr><td style="background:#1a2b4a;padding:28px 32px;">
  <div style="font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;">Meeting minutes</div>
  <div style="font-size:20px;font-weight:700;color:#ffffff;">${escapeHtml(meeting.title)}</div>
  <div style="font-size:13px;color:rgba(255,255,255,0.55);margin-top:4px;">${escapeHtml(formatDate(meeting.date))}</div>
  </td></tr>
  <tr><td style="padding:24px 32px 4px;">
  <div style="font-size:13px;color:#1a2b4a;line-height:1.65;">${escapeHtml(meeting.summary)}</div>
  </td></tr>
  <tr><td style="padding:20px 32px 8px;">
  <div style="font-size:11px;color:#6b7a8d;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;">Hi ${escapeHtml(staff.name.split(' ')[0])}, your action items</div>
  </td></tr>
  <tr><td style="padding:0 32px 24px;">
  <table width="100%" style="border:1px solid rgba(26,43,74,0.1);border-radius:10px;overflow:hidden;">${itemsHtml}</table>
  </td></tr>
  <tr><td style="padding:0 32px 24px;font-size:11px;color:#aab0bb;text-align:center;">TechnoMed Operations Hub · technomed.com.au</td></tr>
  </table></td></tr></table>
  </body></html>`
}

/**
 * Meeting minutes, to one staff member.
 *
 * This used to build its own Resend request with `onboarding@resend.dev`
 * hard-coded as the sender, bypassing the shared sender entirely — so it was
 * refused for all nine staff but whoever owns the Resend account, whatever
 * EMAIL_FROM was set to, and it threw Resend's own JSON at the caller. One
 * sender for everything is the point: a second path is a second thing to find
 * out is broken.
 */
export async function sendMeetingSummaryEmail(staff, meeting, myItems) {
  return send({
    to: [staff.email],
    kind: 'meeting',
    subject: `Meeting minutes — ${meeting.title}`,
    html: buildMeetingEmailHtml(staff, meeting, myItems),
    text: `${meeting.title} (${meeting.date})\n\n${meeting.summary}\n\nYour action items:\n${myItems.length ? myItems.map(i => `- ${i.task} [${i.priority}]${i.due_date ? ' due ' + i.due_date : ''}`).join('\n') : 'None from this meeting.'}`
  })
}



// ─── When a service the portal depends on stops working ──────────────────────
// "On billing/auth errors send one alert email per day to brenton@ saying the
// voice feature is down and why."
//
// Nobody knew the Anthropic account had run out of credit until Ben hit it in a
// corridor at RHH. The whole point of this email is that the next time, the
// person who can fix it finds out before the person who cannot.
//
// Deliberately spare: what broke, which kind of failure, and the API's own
// words. No case, no patient, nothing from the request — the failure is about
// an account, not about whatever somebody happened to be doing at the time.

const FAULT_WORDS = {
  billing: 'the account is out of credit, or billing has failed',
  auth: 'the API key is missing, wrong, or not allowed to do this',
  busy: 'the service is overloaded',
  timeout: 'the service did not answer in time',
  unknown: 'an unexpected error'
}

const FEATURE_WORDS = {
  'voice-booking': 'Speaking a booking',
  'voice-command': 'The voice command button',
  'booking-email': 'Reading booking emails',
  'usage-scan': 'Scanning usage forms',
  'meeting-notes': 'Meeting action lists'
}

export async function sendServiceAlertEmail({ feature, fault, detail }) {
  const what = FEATURE_WORDS[feature] || feature
  const why = FAULT_WORDS[fault] || FAULT_WORDS.unknown
  const to = String(process.env.ALERT_EMAIL || 'brenton@technomed.com.au').trim()

  const action = (fault === 'billing' || fault === 'auth')
    ? 'This will keep failing for everyone until it is fixed. '
      + 'Check console.anthropic.com → Billing, and ANTHROPIC_API_KEY in Vercel.'
    : 'This may clear on its own. If it does not, check status.anthropic.com.'

  const line = `${what} is not working — ${why}.`

  return send({
    to: [to],
    kind: 'notification',
    subject: `Portal: ${what.toLowerCase()} is down`,
    html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f3f7;font-family:-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
  <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr><td style="background:#b42318;padding:22px 28px;">
  <div style="font-size:11px;color:rgba(255,255,255,0.6);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;">Portal alert</div>
  <div style="font-size:17px;font-weight:700;color:#ffffff;">${escapeHtml(line)}</div>
  </td></tr>
  <tr><td style="padding:22px 28px;font-size:14px;color:#042746;line-height:1.6;">
  ${escapeHtml(action)}
  <div style="margin-top:14px;font-size:12px;color:#6b7a8d;">Staff are being shown a message asking them to do it by hand instead, so nothing is lost — but the feature is off until this is sorted.</div>
  ${detail ? `<div style="margin-top:14px;padding:10px 12px;background:#f6f8fa;border-radius:8px;font-family:ui-monospace,monospace;font-size:11.5px;color:#4b5b68;word-break:break-word;">${escapeHtml(String(detail).slice(0, 300))}</div>` : ''}
  <div style="margin-top:14px;font-size:12px;color:#aab0bb;">One of these is sent per feature per day, however many times it fails.</div>
  </td></tr>
  <tr><td style="padding:0 28px 22px;font-size:11px;color:#aab0bb;text-align:center;">TechnoMed Portal · technomed.com.au</td></tr>
  </table></td></tr></table>
  </body></html>`,
    text: `${line}\n\n${action}\n\n${detail ? String(detail).slice(0, 300) + '\n\n' : ''}`
      + 'Staff are being asked to do it by hand instead. One alert per feature per day.'
  })
}

/**
 * A booking notice to a supplier (Tasks 8/9). Sent as the person who
 * confirmed it, replies to them and to bookings@ — the inbox the suppliers
 * already write back to. Logged like every other send.
 */
export async function sendBookingNotice({ to, cc, subject, html, text, sender, caseId }) {
  return send({
    kind: 'notification',
    to, cc, subject, html, text, sender, caseId,
    replyTo: [sender?.email, 'bookings@technomed.com.au'].filter(Boolean)
  })
}

/** "Usage not sent" (Task 11) — to a rep, or to the team leader the next morning. */
export async function sendUsageReminderEmail({ to, firstName, lines, escalation = false }) {
  const intro = escalation
    ? `These cases from yesterday still have no usage sent:`
    : `Hi ${firstName}, these cases of yours today have no usage sent yet:`
  const text = [intro, '', ...lines.map(l => `• ${l}`), '',
    'Send it from Scan in the portal, or open the booking and tap "No usage" if there was none.',
    'https://leave.technomed.com.au'].join('\n')
  const html = `<div style="font-family:-apple-system,sans-serif;font-size:14px;color:#042746">
<p>${escapeHtml(intro)}</p><ul>${lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
<p>Send it from <strong>Scan</strong> in the portal, or open the booking and tap <strong>No usage</strong> if there was none.</p>
<p><a href="https://leave.technomed.com.au">Open the portal</a></p></div>`
  return send({
    kind: 'notification', to: [to],
    subject: escalation ? 'Usage still not sent from yesterday' : 'Usage not sent yet today',
    html, text
  })
}
