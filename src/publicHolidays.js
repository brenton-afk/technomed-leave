// ─── Tasmanian public holidays, as kept in Hobart (Brent, 14 Nov 2026) ───────
// "Public holidays aren't paid at any special rate — you just get paid to not
// be at work at your normal rate (and the on-call person covers it)." So a
// public holiday is: the usual day's hours, pre-filled on the timesheet of
// anyone permanent who normally works that day; and a day the on-call
// allowance runs through, like a weekend.
//
// Worked out from the rules in the Statutory Holidays Act 2000 as they apply
// in Hobart (Regatta and Show Day are southern; Recreation Day is northern and
// Easter Tuesday is a public-service day, so neither is here). A one-off
// holiday the state declares goes in EXTRA. Pure; dates are YYYY-MM-DD.

/** One-off holidays the rules cannot know. { 'YYYY-MM-DD': 'Name' } */
export const EXTRA = {}

const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)
const dow = date => new Date(`${date}T00:00:00Z`).getUTCDay() // 0 Sun … 6 Sat
const add = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/** The nth given weekday (0 Sun … 6 Sat) of a month. */
function nthWeekday(year, month, weekday, n) {
  const first = iso(year, month, 1)
  return add(first, ((weekday - dow(first) + 7) % 7) + 7 * (n - 1))
}

/** Easter Sunday (anonymous Gregorian algorithm). */
export function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return iso(year, month, day)
}

/** Every public holiday in Hobart in a year: { date: name }. */
export function holidaysIn(year) {
  const out = {}
  const put = (date, name) => { out[date] = name }
  const mondayIfWeekend = (date, name) => {
    const w = dow(date)
    put(w === 6 ? add(date, 2) : w === 0 ? add(date, 1) : date, name)
  }
  mondayIfWeekend(iso(year, 1, 1), "New Year's Day")
  mondayIfWeekend(iso(year, 1, 26), 'Australia Day')
  put(nthWeekday(year, 2, 1, 2), 'Royal Hobart Regatta')
  put(nthWeekday(year, 3, 1, 2), 'Eight Hours Day')
  const easter = easterSunday(year)
  put(add(easter, -2), 'Good Friday')
  put(add(easter, 1), 'Easter Monday')
  put(iso(year, 4, 25), 'Anzac Day')
  put(nthWeekday(year, 6, 1, 2), "King's Birthday")
  put(add(nthWeekday(year, 10, 6, 4), -2), 'Royal Hobart Show')
  // Christmas and Boxing Day move off a weekend to the next free weekday.
  const xmas = iso(year, 12, 25)
  const w = dow(xmas)
  if (w === 6) { put(add(xmas, 2), 'Christmas Day'); put(add(xmas, 3), 'Boxing Day') }
  else if (w === 0) { put(add(xmas, 2), 'Christmas Day'); put(add(xmas, 1), 'Boxing Day') }
  else if (w === 5) { put(xmas, 'Christmas Day'); put(add(xmas, 3), 'Boxing Day') }
  else { put(xmas, 'Christmas Day'); put(add(xmas, 1), 'Boxing Day') }
  for (const [date, name] of Object.entries(EXTRA)) if (date.startsWith(String(year))) put(date, name)
  return out
}

/** The holiday's name, or '' — for any date. */
export function publicHoliday(date) {
  const d = String(date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return ''
  return holidaysIn(Number(d.slice(0, 4)))[d] || ''
}

/** { date: name } for the holidays among some dates. */
export function holidaysAmong(days) {
  const out = {}
  for (const d of days || []) { const n = publicHoliday(d); if (n) out[d] = n }
  return out
}

/** Not a working day: Saturday, Sunday or a public holiday. */
export const isDayOff = date => { const w = dow(date); return w === 0 || w === 6 || Boolean(publicHoliday(date)) }
