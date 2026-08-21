// ─── Timesheet validation and totals ──────────────────────────────────────────
// Shared by the API and mirrored by the UI, so the running totals a staff
// member sees are the same numbers that get validated on submit.
import { STANDARD_DAY_HOURS, STANDARD_WEEK_HOURS } from './_fortnight.js'

const MAX_HOURS_PER_DAY = 24
const MAX_CALLOUTS_PER_DAY = 9

export function normaliseEntries(entries, categories, days) {
  const dayset = new Set(days)
  const clean = {}
  for (const category of categories) {
    const raw = entries?.[category.key]
    if (!raw || typeof raw !== 'object') continue
    const cell = {}
    for (const [day, value] of Object.entries(raw)) {
      if (!dayset.has(day)) continue
      const n = Number(value)
      if (!Number.isFinite(n) || n === 0) continue
      cell[day] = Math.round(n * 100) / 100
    }
    if (Object.keys(cell).length) clean[category.key] = cell
  }
  return clean
}

// Hours only — a call-in count is a number of callouts, not time worked, so it
// must never inflate the hours total.
export function totals(entries, categories, days) {
  const byCategory = {}
  const byDay = {}
  let totalHours = 0
  let callouts = 0

  for (const category of categories) {
    const cell = entries?.[category.key] || {}
    let sum = 0
    for (const day of days) {
      const v = Number(cell[day] || 0)
      if (!v) continue
      sum += v
      if (category.unit === 'hours') {
        byDay[day] = (byDay[day] || 0) + v
        totalHours += v
      }
    }
    if (sum) byCategory[category.key] = Math.round(sum * 100) / 100
    if (category.unit === 'count') callouts += sum
  }

  const round = n => Math.round(n * 100) / 100
  const weekHours = [0, 1].map(w =>
    round(days.slice(w * 7, w * 7 + 7).reduce((s, d) => s + (byDay[d] || 0), 0)))

  return {
    byCategory,
    byDay: Object.fromEntries(Object.entries(byDay).map(([d, v]) => [d, round(v)])),
    totalHours: round(totalHours),
    callouts: round(callouts),
    weekHours
  }
}

export function validate(entries, categories, days) {
  const errors = []
  const warnings = []
  const known = new Map(categories.map(c => [c.key, c]))

  for (const [key, cell] of Object.entries(entries || {})) {
    const category = known.get(key)
    if (!category) {
      errors.push(`Unknown pay category "${key}"`)
      continue
    }
    for (const [day, value] of Object.entries(cell)) {
      const n = Number(value)
      if (!Number.isFinite(n)) { errors.push(`${category.label} on ${day} is not a number`); continue }
      if (n < 0) errors.push(`${category.label} on ${day} cannot be negative`)
      if (category.unit === 'hours' && n > MAX_HOURS_PER_DAY) {
        errors.push(`${category.label} on ${day} is more than 24 hours`)
      }
      if (category.unit === 'count' && n > MAX_CALLOUTS_PER_DAY) {
        errors.push(`${category.label} on ${day} looks too high (${n} callouts)`)
      }
    }
  }

  const t = totals(entries, categories, days)

  for (const [day, hours] of Object.entries(t.byDay)) {
    if (hours > MAX_HOURS_PER_DAY) errors.push(`${day} totals more than 24 hours`)
  }
  if (t.totalHours === 0 && t.callouts === 0) errors.push('Enter some hours before submitting')

  // Advisory only — long days and weeks are real, they just deserve a look.
  for (const [day, hours] of Object.entries(t.byDay)) {
    if (hours > STANDARD_DAY_HOURS) {
      const ot = (entries?.overtime_1_5?.[day] || 0) + (entries?.overtime_double?.[day] || 0)
      if (!ot) warnings.push(`${day} is ${hours}h — over the ${STANDARD_DAY_HOURS}h standard day with no overtime recorded`)
    }
  }
  t.weekHours.forEach((hours, i) => {
    if (hours > STANDARD_WEEK_HOURS) warnings.push(`Week ${i + 1} is ${hours}h — over the ${STANDARD_WEEK_HOURS}h standard week`)
  })

  return { ok: errors.length === 0, errors, warnings, totals: t }
}
