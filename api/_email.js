const LEAVE_LABELS = {
  'ANNUAL_LEAVE': 'Annual Leave',
  'SICK': 'Personal / Sick Leave',
  'TOIL': 'Time Off In Lieu (TOIL)'
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function buildEmailHtml({ name, division, startDate, endDate, returnDate, leaveType, reason }) {
  const leaveLabel = LEAVE_LABELS[leaveType] || leaveType
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f3f7;font-family:-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
  <table width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr><td style="background:#1a2b4a;padding:28px 32px;">
  <div style="font-size:22px;font-weight:700;color:#ffffff;">Leave Application</div>
  <div style="font-size:13px;color:rgba(255,255,255,0.55);margin-top:4px;">TechnoMed Staff Portal</div>
  </td></tr>
  <tr><td style="padding:24px 32px 0;">
  <span style="background:#e6f4f2;color:#1a7a6e;padding:5px 14px;border-radius:20px;font-size:13px;font-weight:600;">${leaveLabel}</span>
  </td></tr>
  <tr><td style="padding:20px 32px;">
  <table width="100%" style="border:1px solid rgba(26,43,74,0.1);border-radius:10px;overflow:hidden;">
  <tr style="background:#f8f9fc;"><td style="padding:11px 14px;font-size:12px;color:#6b7a8d;width:140px;">Employee</td><td style="padding:11px 14px;font-size:13px;color:#1a2b4a;font-weight:500;">${name}</td></tr>
  <tr><td style="padding:11px 14px;font-size:12px;color:#6b7a8d;">Division</td><td style="padding:11px 14px;font-size:13px;color:#1a2b4a;font-weight:500;">${division}</td></tr>
  <tr style="background:#f8f9fc;"><td style="padding:11px 14px;font-size:12px;color:#6b7a8d;">First day</td><td style="padding:11px 14px;font-size:13px;color:#1a2b4a;font-weight:500;">${formatDate(startDate)}</td></tr>
  <tr><td style="padding:11px 14px;font-size:12px;color:#6b7a8d;">Last day</td><td style="padding:11px 14px;font-size:13px;color:#1a2b4a;font-weight:500;">${formatDate(endDate)}</td></tr>
  <tr style="background:#f8f9fc;"><td style="padding:11px 14px;font-size:12px;color:#6b7a8d;">Return date</td><td style="padding:11px 14px;font-size:13px;color:#1a2b4a;font-weight:500;">${formatDate(returnDate)}</td></tr>
  <tr><td style="padding:11px 14px;font-size:12px;color:#6b7a8d;">Reason</td><td style="padding:11px 14px;font-size:13px;color:#1a2b4a;font-weight:500;">${reason}</td></tr>
  </table></td></tr>
  <tr><td style="padding:0 32px 24px;font-size:11px;color:#aab0bb;text-align:center;">TechnoMed Leave Portal · technomed.com.au</td></tr>
  </table></td></tr></table>
  </body></html>`
}

export async function sendNotificationEmail(formData) {
  const { name, leaveType } = formData
  const leaveLabel = LEAVE_LABELS[leaveType] || leaveType
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) throw new Error('RESEND_API_KEY not configured')

  const recipients = [
    process.env.EMAIL_TO_1 || 'Erin@technomed.com.au',
    process.env.EMAIL_TO_2 || 'Brenton@technomed.com.au',
    process.env.EMAIL_TO_3 || 'Bookings@technomed.com.au'
  ]

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'TechnoMed Leave Portal <noreply@technomed.com.au>',
      to: recipients,
      subject: `Leave Application — ${name} (${leaveLabel})`,
      html: buildEmailHtml(formData),
      text: `New leave application from ${name}\nLeave type: ${leaveLabel}\nDivision: ${formData.division}\nFrom: ${formData.startDate}\nTo: ${formData.endDate}\nReturn: ${formData.returnDate}\nReason: ${formData.reason}`
    })
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Resend error ${res.status}: ${err}`)
  }

  return { sent: true, recipients }
}
