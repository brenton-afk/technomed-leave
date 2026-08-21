import { STAFF } from '../../src/staffConfig.js'
import { getAllTimesheets } from '../_redis.js'
import { currentPeriod, todayAest } from '../_fortnight.js'
import { sendSms, toE164, twilioConfigured } from '../_twilio.js'

// Vercel cron, Friday and Saturday 22:00 UTC = Saturday and Sunday 8am AEST.
// Tasmania observes daylight saving (AEDT, UTC+11) from October to April, so
// between those months this lands at 9am local rather than 8am. The schedule is
// held in UTC because that is what Vercel accepts; shifting it seasonally would
// need two crons and the Hobby plan allows two in total.
export default async function handler(req, res) {
  // Vercel signs cron invocations with CRON_SECRET when it is set. Without this
  // the endpoint would let anyone trigger an SMS run.
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers?.authorization || ''
    if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorised' })
  }

  try {
    const period = currentPeriod()
    const all = await getAllTimesheets(100)
    const submitted = new Set(
      all.filter(r => r.periodStart === period.start && r.status !== 'rejected').map(r => r.email)
    )

    const owing = STAFF.filter(s => s.hasTimesheets && !submitted.has(s.email))
    const sent = []
    const skipped = []
    const failed = []

    if (!twilioConfigured()) {
      return res.status(200).json({
        ran: true, period: period.start,
        skippedAll: 'Twilio is not configured',
        owing: owing.map(s => s.name)
      })
    }

    const deadline = period.end
    for (const staff of owing) {
      if (!toE164(staff.mobileNumber)) {
        skipped.push({ name: staff.name, reason: 'no mobile number on file' })
        continue
      }
      const body = `Hi ${staff.name.split(' ')[0]}, your TechnoMed timesheet for `
        + `${period.start} to ${period.end} hasn't been submitted yet. `
        + `It's due by end of Sunday ${deadline}. `
        + `Submit it here: https://technomed-leave.vercel.app`
      try {
        const result = await sendSms(staff.mobileNumber, body)
        sent.push({ name: staff.name, to: result.to })
      } catch (err) {
        failed.push({ name: staff.name, error: err.message })
      }
    }

    return res.status(200).json({
      ran: true,
      today: todayAest(),
      period: { start: period.start, end: period.end },
      owing: owing.length,
      sent,
      skipped,
      failed
    })
  } catch (err) {
    console.error('timesheet-reminder failed:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
