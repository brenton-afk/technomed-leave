// ─── Email Notifications via SendGrid ────────────────────────────────────────
// Sends formatted HTML email to Erin, Brenton and Bookings on leave submission

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

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f0f3f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid rgba(26,43,74,0.1);">

          <!-- Header -->
          <tr>
            <td style="background:#1a2b4a;padding:28px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <div style="display:inline-block;background:#2ab5a0;border-radius:8px;padding:6px 10px;font-size:13px;font-weight:700;color:white;letter-spacing:-0.3px;margin-bottom:12px;">TM</div>
                    <div style="font-size:11px;color:rgba(255,255,255,0.45);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;">TechnoMed Staff Portal</div>
                    <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">Leave Application</h1>
                    <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.55);">Submitted via TechnoMed Leave Portal</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Leave type badge -->
          <tr>
            <td style="padding:24px 32px 0;">
              <span style="display:inline-block;background:#e6f4f2;color:#1a7a6e;padding:5px 14px;border-radius:20px;font-size:13px;font-weight:600;">${leaveLabel}</span>
            </td>
          </tr>

          <!-- Details table -->
          <tr>
            <td style="padding:20px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid rgba(26,43,74,0.1);border-radius:10px;overflow:hidden;">
                ${[
                  ['Employee', name],
                  ['Division', division],
                  ['First day of leave', formatDate(startDate)],
                  ['Last day of leave', formatDate(endDate)],
                  ['Return to work', formatDate(returnDate)],
                  ['Leave type', leaveLabel],
                  ['Reason', reason]
                ].map(([label, value], i) => `
                <tr style="background:${i % 2 === 0 ? '#f8f9fc' : '#ffffff'};">
                  <td style="padding:11px 14px;font-size:12px;color:#6b7a8d;width:140px;border-bottom:1px solid rgba(26,43,74,0.07);">${label}</td>
                  <td style="padding:11px 14px;font-size:13px;color:#1a2b4a;font-weight:500;border-bottom:1px solid rgba(26,43,74,0.07);">${value}</td>
                </tr>`).join('')}
              </table>
            </td>
          </tr>

          <!-- Integrations confirmed -->
          <tr>
            <td style="padding:0 32px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f3f7;border-radius:10px;padding:14px 16px;">
                <tr>
                  <td style="font-size:12px;color:#6b7a8d;line-height:1.7;">
                    ✅ &nbsp;Leave application lodged in <strong>Xero</strong> under employee record<br>
                    📅 &nbsp;Event added to <strong>TechnoMed Bookings Calendar</strong> (Grape)<br>
                    📧 &nbsp;This email sent to Erin, Brenton and Bookings
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8f9fc;padding:16px 32px;border-top:1px solid rgba(26,43,74,0.07);">
              <p style="margin:0;font-size:11px;color:#aab0bb;text-align:center;">
                TechnoMed Leave Portal &nbsp;·&nbsp; Tasmanian Medical Devices &nbsp;·&nbsp; www.technomed.com.au
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export async function sendNotificationEmail(formData) {
  const { name, leaveType } = formData
  const leaveLabel = LEAVE_LABELS[leaveType] || leaveType
  const apiKey = process.env.SENDGRID_API_KEY

  if (!apiKey) throw new Error('SENDGRID_API_KEY not configured')

  const recipients = [
    process.env.EMAIL_TO_1 || 'Erin@technomed.com.au',
    process.env.EMAIL_TO_2 || 'Brenton@technomed.com.au',
    process.env.EMAIL_TO_3 || 'Bookings@technomed.com.au'
  ]

  const payload = {
    personalizations: [{
      to: recipients.map(email => ({ email })),
      subject: `Leave Application — ${name} (${leaveLabel})`
    }],
    from: {
      email: process.env.EMAIL_FROM || 'noreply@technomed.com.au',
      name: 'TechnoMed Leave Portal'
    },
    reply_to: { email: 'Erin@technomed.com.au' },
    content: [
      {
        type: 'text/plain',
        value: `New leave application from ${name}\n\nLeave type: ${leaveLabel}\nDivision: ${formData.division}\nFrom: ${formData.startDate}\nTo: ${formData.endDate}\nReturn: ${formData.returnDate}\nReason: ${formData.reason}`
      },
      {
        type: 'text/html',
        value: buildEmailHtml(formData)
      }
    ]
  }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`SendGrid error ${res.status}: ${err}`)
  }

  return { sent: true, recipients }
}
