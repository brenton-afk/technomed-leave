// ─── Derivation: calendar events → WeekPlan ───────────────────────────────────
// Pure. No fetching, no React, no dates from the ambient clock except the
// `generatedAt` that is passed in. This is what makes the same plan reusable by
// the UI, the text copy and the .docx export without any of them diverging.

import './types.js'
import {
  normaliseEvent, parseCaseTitle, detectHospital, stripIdentifiers, HOSPITALS, describeCase
} from './parse.js'
import { colourNameFor, checkEventColour, surgeonForColourName } from './colours.js'
import {
  formatWeekRange, formatDayHeading, weekdayName, formatTimeRange,
  zonedCivil, parseDateStr, TZ
} from './week.js'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

// How a non-case event is classified. Order matters — the first match wins, so
// the more specific patterns are listed first. These are heuristics over
// free-text calendar titles, which is the only signal available.
// Checked before the meeting test: these are always flags, even when the title
// also reads like a meeting ("Handover: ..." contains a word the meeting
// pattern matches).
const PRIORITY_FLAG_RULES = [
  { kind: 'recurringStaffing', boxed: true, test: /late start|early finish|reduced hours|boy'?s week/i },
  { kind: 'handover', boxed: false, test: /handover|team leader/i },
  { kind: 'travel', boxed: false, test: /conference|offsite|off-site|travel|depart|flight|on call|on-call/i },
  { kind: 'clinicalAlert', boxed: false, test: /revision|loan kit|resupply|urgent|shortage|recall/i }
]

// Checked only after the meeting test, so "Spine Logistics Meeting" renders as
// a grey-bar block (as the document does) rather than as a logistics flag.
const LATE_FLAG_RULES = [
  { kind: 'logistics', boxed: false, test: /sterilis|steriliz|stock|resupply/i }
]

// Meetings and named logistics entries get their own grey-bar block rather than
// being rolled into the "Other:" line.
const NON_SURGEON_BLOCK = /meeting|catch up|catch-up|transfer|logistics|handover|review|huddle/i

// Routine markers that belong on the "Other:" roll-up line.
const ROLLUP_HINT = /wfh|office|tm office|list order|day off|annual leave|personal leave|leave\b/i

// Bookings that were probably meant to be cases but did not parse. A title has
// to match `<Patient> <KIT> - <Surgeon>` with a *known* surgeon, so a locum, a
// spelling variant or initials quietly demoted the booking to a line of italic
// text. Anything carrying a separator or a surgeon's colour is called out
// instead, because a case that silently disappears is the worst failure this
// screen can have.
function looksLikeMisfiledCase(event, title) {
  if (event.allDay) return false
  if (ROLLUP_HINT.test(title)) return false
  const hasSeparator = /\s+[-–—]\s+/.test(title)
  const wearsSurgeonColour = Boolean(surgeonForColourName(colourNameFor(event.colorId)))
  return hasSeparator || wearsSurgeonColour
}

function classifyFlag(title, rules) {
  for (const rule of rules) {
    if (rule.test.test(title)) return rule
  }
  return null
}

function isAlertFlag(kind) {
  return kind === 'clinicalAlert'
}

/** Groups events by the Hobart calendar day they start on. */
function bucketByDay(events, days, tz) {
  const buckets = new Map(days.map(d => [d, []]))
  for (const event of events) {
    const dayKeys = daysCovered(event, days, tz)
    for (const key of dayKeys) {
      if (buckets.has(key)) buckets.get(key).push(event)
    }
  }
  return buckets
}

// An all-day event spanning several days appears on each day it covers; a timed
// event belongs to the day it starts.
function daysCovered(event, days, tz) {
  if (event.allDay && event.startDate) {
    const from = event.startDate
    // Google's all-day end date is exclusive.
    const toExclusive = event.endDate || event.startDate
    return days.filter(d => d >= from && d < toExclusive || d === from)
  }
  if (!event.start) return []
  // A calendar entry with an unreadable date used to throw from inside the
  // timezone maths and take the whole week's plan with it. One bad booking should
  // cost that booking, not the plan.
  const at = new Date(event.start)
  if (Number.isNaN(at.getTime())) return []
  const civil = zonedCivil(at, tz)
  const key = `${civil.year}-${String(civil.month).padStart(2, '0')}-${String(civil.day).padStart(2, '0')}`
  return [key]
}

function caseCountLine(cases, nonSurgeonItems) {
  if (cases.length === 0) {
    if (nonSurgeonItems.length === 1) return 'No surgical cases — 1 internal meeting'
    if (nonSurgeonItems.length > 1) return `No surgical cases — ${nonSurgeonItems.length} internal meetings`
    return 'No surgical cases'
  }
  const byHospital = new Map()
  for (const c of cases) byHospital.set(c.hospital, (byHospital.get(c.hospital) || 0) + 1)
  const shortName = h => h === HOSPITALS.CALVARY ? 'Calvary' : h
  // Same order the case blocks use, so the count line reads in the order the
  // reader is about to scan.
  const rank = h => h === HOSPITALS.RHH ? 0 : h === HOSPITALS.CALVARY ? 1 : 2
  const breakdown = [...byHospital.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([h, n]) => `${n} ${shortName(h)}`).join(', ')
  return `${cases.length} case${cases.length === 1 ? '' : 's'} — ${breakdown}`
}

function groupByHospital(cases) {
  const order = []
  const map = new Map()
  for (const c of cases) {
    if (!map.has(c.hospital)) { map.set(c.hospital, []); order.push(c.hospital) }
    map.get(c.hospital).push(c)
  }
  // RHH first, then Calvary, then anything else — the document's order.
  const rank = h => h === HOSPITALS.RHH ? 0 : h === HOSPITALS.CALVARY ? 1 : 2
  order.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  return order.map(hospital => ({
    hospital,
    cases: map.get(hospital).slice().sort((a, b) => String(a.start).localeCompare(String(b.start)))
  }))
}

// ─── Derived prose (§6.1, §6.3) ─────────────────────────────
// Templated from what the events actually say. Deliberately mechanical: it
// states what is on rather than trying to imitate a person's editorial voice.

function listPhrase(items) {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
function countWord(n) {
  return COUNT_WORDS[n] || String(n)
}

function buildSummaryLine(allCases, surgeons, days) {
  if (allCases.length === 0) {
    const meetings = days.reduce((n, d) => n + d.nonSurgeonItems.length, 0)
    return meetings
      ? `No surgical cases this week; ${meetings} internal meeting${meetings === 1 ? '' : 's'} scheduled.`
      : 'No surgical cases or meetings scheduled this week.'
  }

  const headline = []
  for (const day of days) {
    for (const flag of day.flags) {
      if (flag.kind === 'travel' || flag.kind === 'handover') headline.push(flag.text)
    }
  }
  const unique = [...new Set(headline)].slice(0, 3)

  const base = `${allCases.length} surgical case${allCases.length === 1 ? '' : 's'} across `
    + `${countWord(surgeons.length)} surgeon${surgeons.length === 1 ? '' : 's'}`
  return unique.length ? `${base}, plus ${listPhrase(unique)}.` : `${base}.`
}

function buildNotes(findings, days) {
  const parts = []
  // A booking with no colour set is an administrative tidy-up, not something the
  // week's plan needs to open with, so only a genuine mismatch is mentioned —
  // where the colour and the title disagree about who is operating.
  const wrong = findings.filter(f => f.kind === 'wrongColour')
  if (wrong.length) {
    parts.push(`${wrong.length === 1 ? 'One booking is' : `${wrong.length} bookings are`} coloured against the guide.`)
  }

  const travel = [...new Set(days.flatMap(d => d.flags.filter(f => f.kind === 'travel').map(f => f.text)))]
  if (travel.length) parts.push(`${listPhrase(travel)}; factor into on-site coverage.`)

  const handover = [...new Set(days.flatMap(d => d.flags.filter(f => f.kind === 'handover').map(f => f.text)))]
  if (handover.length) parts.push(`${listPhrase(handover)}.`)

  const alerts = [...new Set(days.flatMap(d => d.flags.filter(f => isAlertFlag(f.kind)).map(f => f.text)))]
  if (alerts.length) parts.push(`${listPhrase(alerts)}.`)

  return parts.join(' ') || 'No outstanding issues flagged for this week.'
}

// ─── Key flags (§6.7) ───────────────────────────────────────

function buildKeyFlags(allCases, days, findings, surgeons) {
  const flags = []

  if (allCases.length) {
    const perSurgeon = surgeons.map(surgeon => {
      const own = allCases.filter(c => c.surgeon === surgeon)
      const dayNames = [...new Set(own.map(c => weekdayName(c.dayDate).slice(0, 3)))]
      const hospitals = [...new Set(own.map(c => c.hospital === HOSPITALS.CALVARY ? 'Calvary' : c.hospital))]
      return `${surgeon} (${own.length} case${own.length === 1 ? '' : 's'} ${dayNames.join('/')}, ${hospitals.join(' & ')})`
    })
    flags.push({ label: 'Surgeon load', text: perSurgeon.join(', ') + '.' })
  }

  const byKind = kind => [...new Set(days.flatMap(d => d.flags.filter(f => f.kind === kind).map(f => f.text)))]

  const handover = byKind('handover')
  if (handover.length) flags.push({ label: 'Team leader handover', text: listPhrase(handover) + '.' })

  const staffing = [...new Set(days.flatMap(d =>
    d.flags.filter(f => f.kind === 'recurringStaffing' || f.kind === 'staffing').map(f => f.text)))]
  if (staffing.length) flags.push({ label: 'Staffing', text: listPhrase(staffing) + '.' })

  const travel = byKind('travel')
  if (travel.length) flags.push({ label: 'Travel', text: listPhrase(travel) + '.' })

  const logistics = [
    ...byKind('logistics'),
    ...[...new Set(days.flatMap(d => d.otherRollup.filter(o => /list order/i.test(o.text)).map(() => 'Daily List Order call')))]
  ]
  if (logistics.length) flags.push({ label: 'Logistics', text: listPhrase([...new Set(logistics)]) + '.' })

  const alerts = byKind('clinicalAlert')
  if (alerts.length) flags.push({ label: 'Clinical alerts', text: listPhrase(alerts) + '.' })

  const unrecognised = days.flatMap(d => d.needsAttention || [])
  if (unrecognised.length) {
    flags.push({
      label: 'Bookings needing attention',
      text: `${unrecognised.length} booking${unrecognised.length === 1 ? '' : 's'} on the calendar `
        + `could not be read as a case and ${unrecognised.length === 1 ? 'is' : 'are'} not counted above — `
        + unrecognised.map(u => `"${u.text}"`).join('; ')
        + '. Check the title reads "<Patient> <KIT> - <Surgeon>" with a known surgeon.'
    })
  }

  // Always present, so a reader can see the check ran even in a clean week.
  // No colour-coding summary. It restated, in a paragraph of prose, what the
  // per-case markers already say in place, and it was the longest thing on the
  // page while being the least actionable. The colour data is still used where it
  // does work: attributing a surgeon to a booking whose title does not name one.
  return flags
}

/**
 * @param {Array<object>} rawEvents  Google Calendar events (bookings + leave)
 * @param {{ startDate: string, endDate: string, days: string[] }} window
 * @param {{ generatedAt?: string, tz?: string }} [opts]
 * @returns {import('./types.js').WeekPlan}
 */
export function buildWeekPlan(rawEvents, window, opts = {}) {
  const tz = opts.tz || TZ
  const generatedAt = opts.generatedAt || new Date().toISOString()
  const days = window.days
  const events = (rawEvents || []).map(normaliseEvent)
  const buckets = bucketByDay(events, days, tz)

  // First pass: identify every case, so the colour check knows which surgeons
  // actually have work this week.
  const allCases = []
  for (const dayDate of days) {
    for (const event of buckets.get(dayDate) || []) {
      // The colour is a real signal, not decoration: the team's guide exists so
      // surgeon allocation is visible at a glance. Where the title does not
      // name a surgeon, the colour is allowed to.
      const colourSurgeon = surgeonForColourName(colourNameFor(event.colorId))
      const parsed = parseCaseTitle(event.rawTitle, { colourSurgeon })
      if (!parsed || event.allDay) continue
      // One reader for the whole booking, so each fact lands in exactly one
      // field however the booking happens to be written. See describeCase.
      const { operation, system, supply, kit } = describeCase(parsed.procedure, event.description)
      allCases.push({
        id: event.id,
        patient: parsed.patient,
        surgeon: parsed.surgeon,
        // The title's raw middle section is not kept: it ran the operation and
        // the system together, which is exactly the ambiguity being removed.
        operation,
        system,
        supply,
        kit,
        hospital: detectHospital(event.location, event.description, { caseEvent: true }),
        start: event.start,
        end: event.end,
        calendarColorName: colourNameFor(event.colorId) || undefined,
        surgeonSource: parsed.surgeonSource,
        notes: [],
        dayDate,
        _event: event
      })
    }
  }
  const surgeonsWithCases = [...new Set(allCases.map(c => c.surgeon))]

  // Second pass: colour findings, attached to their case and rolled up.
  const findings = []
  for (const c of allCases) {
    if (c.surgeonSource === 'colour') {
      // Attributed *by* its colour, so checking it against its colour would
      // report a fault that cannot exist. Say where the surgeon came from
      // instead, so the inference is visible rather than silent.
      c.notes.push({
        text: `Surgeon read from the calendar colour (${c.calendarColorName}) — the title does not name one`,
        kind: 'info'
      })
      continue
    }
    const finding = checkEventColour({
      id: c.id, title: `${c.patient}/${c.surgeon}`, date: c.dayDate,
      colorId: c._event.colorId, surgeon: c.surgeon, isCase: true, surgeonsWithCases
    })
    if (finding) {
      findings.push(finding)
      c.notes.push({ text: `■ ${finding.message}`, kind: 'colourCoding' })
    }
  }

  // Third pass: the day blocks.
  const dayPlans = days.map(dayDate => {
    const dayEvents = buckets.get(dayDate) || []
    const cases = allCases.filter(c => c.dayDate === dayDate)
    const caseIds = new Set(cases.map(c => c.id))

    /** @type {import('./types.js').DayFlag[]} */
    const flags = []
    const nonSurgeonItems = []
    const otherRollup = []
    const needsAttention = []

    for (const event of dayEvents) {
      if (caseIds.has(event.id)) continue
      // An untitled event used to be skipped outright, which meant it vanished
      // from the app while still sitting on the calendar.
      const title = stripIdentifiers(event.title) || '(untitled booking)'

      const nonCaseFinding = checkEventColour({
        id: event.id, title, date: dayDate, colorId: event.colorId,
        surgeon: null, isCase: false, surgeonsWithCases
      })
      if (nonCaseFinding) findings.push(nonCaseFinding)

      const timeRange = formatTimeRange(event.start, event.end, tz)
      const asFlag = rule => {
        flags.push({ text: timeRange && !event.allDay ? `${title} · ${timeRange}` : title, kind: rule.kind, boxed: rule.boxed })
      }

      const priority = classifyFlag(title, PRIORITY_FLAG_RULES)
      if (priority) { asFlag(priority); continue }

      if (!event.allDay && NON_SURGEON_BLOCK.test(title)) {
        nonSurgeonItems.push({ text: timeRange ? `${title} · ${timeRange}` : title, start: event.start, end: event.end, allDay: false })
        continue
      }

      const late = classifyFlag(title, LATE_FLAG_RULES)
      if (late) { asFlag(late); continue }
      if (looksLikeMisfiledCase(event, title)) {
        needsAttention.push({
          id: event.id,
          text: timeRange ? `${title} · ${timeRange}` : title,
          reason: /\s+[-–—]\s+/.test(title)
            ? 'Reads like a case but the surgeon was not recognised'
            : `Coloured as a surgeon's case but the title does not parse`,
          start: event.start || undefined,
          end: event.end || undefined
        })
        continue
      }
      otherRollup.push({
        text: event.allDay ? `${title} (all day)` : (timeRange ? `${title} ${timeRange}` : title),
        start: event.start || undefined,
        end: event.end || undefined,
        allDay: event.allDay
      })
    }

    // Boxed recurring-staffing flags first, then the rest — flags render above
    // the hospital subheading (§6.4.4).
    flags.sort((a, b) => Number(b.boxed) - Number(a.boxed))

    return {
      date: dayDate,
      weekday: weekdayName(dayDate),
      caseCountLine: caseCountLine(cases, nonSurgeonItems),
      flags,
      casesByHospital: groupByHospital(cases.map(stripInternals)),
      nonSurgeonItems,
      otherRollup,
      needsAttention
    }
  })

  const surgeons = surgeonsWithCases.slice().sort()
  const hospitals = [...new Set(allCases.map(c => c.hospital))]
  const hospitalLabel = hospitals.length
    ? hospitals.map(h => h === HOSPITALS.CALVARY ? 'Calvary (Lenah Valley)' : h).join(' & ')
    : 'No hospitals booked'

  const startCivil = parseDateStr(window.startDate)
  const endCivil = parseDateStr(window.endDate)
  const fridayCivil = parseDateStr(days[4])

  return {
    weekStart: window.startDate,
    weekEnd: window.endDate,
    title: `TechnoMed Clinical Plan — ${formatWeekRange(window.startDate, window.endDate)}`,
    // The exported document must carry both the range and the hospitals (§6.1).
    subtitle: `${formatDayHeading(days[0])} – ${formatDayHeading(days[4])} ${fridayCivil.year} · ${hospitalLabel}`
      .replace(`${MONTHS[startCivil.month - 1]} –`, '–'),
    summaryLine: buildSummaryLine(allCases, surgeons, dayPlans),
    surgeons,
    notes: buildNotes(findings, dayPlans),
    days: dayPlans,
    keyFlags: buildKeyFlags(allCases, dayPlans, findings, surgeons),
    colourCodingFindings: findings,
    readings: buildReadings(days, buckets, allCases),
    lastGeneratedAt: generatedAt,
    _endYear: endCivil.year
  }
}

/**
 * What the plan made of every booking in the window, side by side with what was
 * typed into the calendar.
 *
 * Bookings are free text, so the plan is always an interpretation of them. Until
 * now that interpretation was invisible: a booking read the wrong way looked
 * exactly like a booking entered the wrong way, and there was no way to tell
 * which — or to see that a case had been dropped entirely. This makes the
 * interpretation inspectable, so a title that reads badly can be either retyped
 * or reported.
 *
 * Identifiers are stripped, as everywhere else — a diagnostic is not a licence to
 * show more than the plan does.
 */
function buildReadings(days, buckets, allCases) {
  const readCases = new Map(allCases.map(c => [c.id, c]))
  const out = []

  for (const dayDate of days) {
    for (const event of buckets.get(dayDate) || []) {
      const title = stripIdentifiers(event.rawTitle || '')
      if (!title) continue
      const read = readCases.get(event.id)
      out.push({
        date: dayDate,
        title,
        // First line only. The rest is usually logistics prose, and the point
        // here is what the plan read, not to reproduce the note.
        note: stripIdentifiers((event.description || '').split(/\r?\n/).find(l => l.trim()) || ''),
        colour: colourNameFor(event.colorId) || undefined,
        allDay: Boolean(event.allDay),
        read: read
          ? {
            patient: read.patient,
            surgeon: read.surgeon,
            surgeonSource: read.surgeonSource,
            operation: read.operation,
            system: read.system,
            supply: read.supply,
            kit: read.kit
          }
          : undefined,
        // Why it is not on the plan as a case. An all-day entry or a meeting is
        // expected; a booking that looks like a case but did not parse is not.
        status: read ? 'case' : (event.allDay ? 'all-day entry' : 'not read as a case')
      })
    }
  }
  return out
}

// The internal helpers used during derivation never reach the rendered plan.
function stripInternals(c) {
  const { dayDate, _event, ...rest } = c
  return rest
}
