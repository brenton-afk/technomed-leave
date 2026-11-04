import { STAFF } from '../../src/staffConfig.js'
import { getAllTimesheets } from '../_redis.js'
import { currentPeriod, todayAest } from '../_fortnight.js'
import { sendSms, toE164, twilioConfigured } from '../_twilio.js'
import { owingFor, caseLine, leaderEmailFor } from '../_usageReminders.js'
import { sendUsageReminderEmail, PORTAL_URL } from '../_email.js'
import { notify } from '../_push.js'
import { TZ, zonedCivil, toDateStr, addCivilDays } from '../../src/clinicalPlan/week.js'

// ─── The two daily runs ──────────────────────────────────────────────────────
// Vercel's Hobby plan allows two scheduled jobs, so both share this function
// and say which they are with ?job=:
//
//   evening  07:00 UTC — 6pm in Hobart during daylight saving (5pm in winter).
//            "Usage not sent" reminders to each rep for today's cases (Task 11).
//   morning  22:00 UTC — 9am Hobart in summer (8am in winter).
//            Yesterday's still-unsent usage to the week's team leader, and on
//            Saturday and Sunday the timesheet reminders, as before.
//
// Held in UTC because that is what Vercel takes; a seasonal second pair would
// need more jobs than the plan allows.

function hobartToday() {
  return toDateStr(zonedCivil(new Date(), TZ))
}

function hobartWeekday() {
  return new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short' }).format(new Date())
}

// ─── Paused ───────────────────────────────────────────────────────────────────
// "Please pause the usage reminder emails as they are not accurate, since we
// are not yet sending usage from the portal yet." — Brent, 3 Nov 2026.
//
// The reminders count a case as unsent unless the portal sent its usage, so
// while usage still goes out by hand every case reads as owing. Both the 6pm
// email to each rep and the 9am escalation to the team leader are off until
// USAGE_REMINDERS=on is set in Vercel. The timesheet reminders are unaffected.
export function usageRemindersOn() {
  return String(process.env.USAGE_REMINDERS || '').trim().toLowerCase() === 'on'
}

async function usageEvening() {
  const day = hobartToday()
  const { byEmail } = await owingFor(day)
  const sent = []
  const failed = []
  for (const { staff, cases } of byEmail.values()) {
    const lines = cases.map(caseLine)
    try {
      await sendUsageReminderEmail({ to: staff.email, firstName: staff.firstName, lines })
      sent.push(staff.firstName)
    } catch (err) {
      failed.push({ name: staff.firstName, error: err.message })
    }
    await notify([staff.email], {
      title: 'Usage not sent yet', body: lines.join('; '), tag: 'usage-reminder', url: '/'
    }).catch(() => {})
  }
  return { day, reminded: sent, failed }
}

async function usageMorning() {
  const yesterday = toDateStr(addCivilDays(zonedCivil(new Date(), TZ), -1))
  const { owing } = await owingFor(yesterday)
  if (!owing.length) return { day: yesterday, escalated: 0 }
  const leader = await leaderEmailFor(yesterday)
  if (!leader) return { day: yesterday, escalated: 0, skipped: 'no team leader for that week' }
  const lines = owing.map(c => `${caseLine(c)} — ${c.who.join(' + ')}`)
  await sendUsageReminderEmail({ to: leader, lines, escalation: true })
  return { day: yesterday, escalated: owing.length, to: leader }
}

export default async function handler(req, res) {
  // Vercel signs cron invocations with CRON_SECRET. This used to check the
  // signature only when the secret happened to be set, which meant a missing
  // environment variable silently opened the endpoint — and this endpoint texts
  // every member of staff. An unset secret is now a refusal, not a waiver: a
  // reminder that does not go out is a Monday morning problem, and one anybody
  // on the internet can send at three in the morning is a worse one.
  const secret = process.env.CRON_SECRET
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET is not configured' })
  if ((req.headers?.authorization || '') !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorised' })
  }

  const job = String(req.query?.job || '')

  // Each part in its own try, so a calendar that will not answer does not stop
  // the timesheet reminders, and the other way round.
  if (job === 'evening') {
    if (!usageRemindersOn()) return res.status(200).json({ ran: 'evening', usage: 'paused' })
    try {
      return res.status(200).json({ ran: 'evening', usage: await usageEvening() })
    } catch (err) {
      console.error('usage reminder (evening) failed:', err.message)
      return res.status(500).json({ error: err.message })
    }
  }

  let usage = null
  if (job === 'morning') {
    try {
      usage = usageRemindersOn() ? await usageMorning() : 'paused'
    } catch (err) {
      console.error('usage reminder (morning) failed:', err.message)
      usage = { error: err.message }
    }
    // Timesheet reminders only at the weekend, as when this ran Sat/Sun only.
    if (!['Sat', 'Sun'].includes(hobartWeekday())) {
      return res.status(200).json({ ran: 'morning', usage, timesheets: 'not a weekend' })
    }
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
        ran: true, usage, period: period.start,
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
        + `Submit it here: ${PORTAL_URL}`
      try {
        const result = await sendSms(staff.mobileNumber, body)
        sent.push({ name: staff.name, to: result.to })
      } catch (err) {
        failed.push({ name: staff.name, error: err.message })
      }
    }

    return res.status(200).json({
      ran: true,
      usage,
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
