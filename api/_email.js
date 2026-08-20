import { STAFF } from '../src/staffConfig.js'

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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function adminRecipients() {
  return [
    process.env.EMAIL_TO_1 || 'Erin@technomed.com.au',
    process.env.EMAIL_TO_2 || 'Brenton@technomed.com.au',
    process.env.EMAIL_TO_3 || 'Bookings@technomed.com.au'
  ]
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
  </table></td></tr>
  <tr><td style="padding:0 32px 24px;font-size:11px;color:#aab0bb;text-align:center;">TechnoMed Leave Portal · technomed.com.au</td></tr>
  </table></td></tr></table>
  </body></html>`
}

async function send({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY not configured')

  const recipients = to.filter(Boolean)
  if (recipients.length === 0) throw new Error('No recipients for email')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'TechnoMed Leave Portal <onboarding@resend.dev>',
      to: recipients,
      subject,
      html,
      text
    })
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Resend error ${res.status}: ${err}`)
  }

  return { sent: true, recipients }
}

function summaryText(application, prefix, extra = '') {
  const leaveLabel = LEAVE_LABELS[application.leaveType] || application.leaveType
  return `${prefix}\nEmployee: ${application.name}\nLeave type: ${leaveLabel}\nDivision: ${application.division}\nFrom: ${application.startDate}\nTo: ${application.endDate}\nReturn: ${application.returnDate}\nReason: ${application.reason}${extra}`
}

// Sent to the approvers when a new application is submitted.
export async function sendNotificationEmail(application) {
  const leaveLabel = LEAVE_LABELS[application.leaveType] || application.leaveType
  return send({
    to: adminRecipients(),
    subject: `Leave Application — ${application.name} (${leaveLabel})`,
    html: buildEmailHtml(application, 'submitted'),
    text: summaryText(application, `New leave application from ${application.name}`)
  })
}

// Sent to the employee (cc approvers) once an application is approved.
export async function sendApprovalEmail(application) {
  const leaveLabel = LEAVE_LABELS[application.leaveType] || application.leaveType
  return send({
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

// ─── MEETING MINUTES / ACTION ITEMS ────────────────────────

const PRIORITY_COLORS = { urgent: '#c0392b', normal: '#1a7a6e', low: '#6b7a8d' }
const PRIORITY_LABELS = { urgent: 'Urgent', normal: 'Normal', low: 'Low' }

function buildMeetingEmailHtml(staff, meeting, myItems) {
  const itemsHtml = myItems.length
    ? myItems.map(it => `
      <tr><td style="padding:11px 14px;border-bottom:1px solid rgba(26,43,74,0.06);">
        <div style="font-size:13px;font-weight:600;color:#1a2b4a;">${it.task}</div>
        <div style="font-size:11px;margin-top:3px;">
          <span style="color:${PRIORITY_COLORS[it.priority] || '#6b7a8d'};font-weight:600;text-transform:uppercase;letter-spacing:0.3px;">${PRIORITY_LABELS[it.priority] || it.priority}</span>
          ${it.due_date ? `<span style="color:#6b7a8d;"> · Due ${formatDate(it.due_date)}</span>` : ''}
        </div>
        ${it.notes ? `<div style="font-size:12px;color:#6b7a8d;margin-top:5px;line-height:1.5;">${it.notes}</div>` : ''}
      </td></tr>`).join('')
    : `<tr><td style="padding:20px 14px;font-size:13px;color:#6b7a8d;text-align:center;">No action items assigned to you from this meeting.</td></tr>`

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f3f7;font-family:-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
  <table width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr><td style="background:#1a2b4a;padding:28px 32px;">
  <div style="font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;">Meeting minutes</div>
  <div style="font-size:20px;font-weight:700;color:#ffffff;">${meeting.title}</div>
  <div style="font-size:13px;color:rgba(255,255,255,0.55);margin-top:4px;">${formatDate(meeting.date)}</div>
  </td></tr>
  <tr><td style="padding:24px 32px 4px;">
  <div style="font-size:13px;color:#1a2b4a;line-height:1.65;">${meeting.summary}</div>
  </td></tr>
  <tr><td style="padding:20px 32px 8px;">
  <div style="font-size:11px;color:#6b7a8d;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;">Hi ${staff.name.split(' ')[0]}, your action items</div>
  </td></tr>
  <tr><td style="padding:0 32px 24px;">
  <table width="100%" style="border:1px solid rgba(26,43,74,0.1);border-radius:10px;overflow:hidden;">${itemsHtml}</table>
  </td></tr>
  <tr><td style="padding:0 32px 24px;font-size:11px;color:#aab0bb;text-align:center;">TechnoMed Operations Hub · technomed.com.au</td></tr>
  </table></td></tr></table>
  </body></html>`
}

export async function sendMeetingSummaryEmail(staff, meeting, myItems) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY not configured')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'TechnoMed Operations Hub <onboarding@resend.dev>',
      to: [staff.email],
      subject: `Meeting minutes — ${meeting.title}`,
      html: buildMeetingEmailHtml(staff, meeting, myItems),
      text: `${meeting.title} (${meeting.date})\n\n${meeting.summary}\n\nYour action items:\n${myItems.length ? myItems.map(i => `- ${i.task} [${i.priority}]${i.due_date ? ' due ' + i.due_date : ''}`).join('\n') : 'None from this meeting.'}`
    })
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Resend error ${res.status}: ${err}`)
  }
  return { sent: true }
}
