// ─── Hobart public holidays ──────────────────────────────────────────────────
// "The portal adds Hobart public holidays to the bookings calendar
// automatically, so nobody has to ask for them."
//
// A public holiday is not a day off for this team so much as a day the
// hospitals do not run elective lists. Knowing which ones are coming is what
// stops a kit being ordered for a Monday nobody is operating on, and until now
// it was knowledge somebody had to remember to put in the calendar.
//
// ── Where the dates come from ──
//
// The brief names the data.gov.au "Australian Public Holidays Dates Machine
// Readable Dataset", read through the CKAN API, and that is what this tries
// first. It should be said plainly that as of October 2026 it will not answer:
// the dataset is titled "[INACTIVE]", its newest resource is 2025, and no
// successor exists on data.gov.au. So in practice the checked-in file is the
// source and the fetch is the thing that might one day take over.
//
// Both paths are kept because the shape of the problem is "whichever of these
// knows about the year you asked for", and which one that is will change. Every
// answer says which it came from, and the cron logs it.
//
// ── What Hobart's list is ──
//
// Three rules, and none of them falls out of the national dataset:
//
//   · ROYAL HOBART REGATTA is in. It is a southern-Tasmania holiday — the
//     second Monday in February — and the dataset's tas rows have never
//     carried it, so it is added here rather than filtered in.
//   · RECREATION DAY is out. First Monday in November, northern Tasmania only.
//     Not in the dataset either, so the exclusion is a guard rather than a
//     filter: a different source, or a future one, may well include it.
//   · EASTER TUESDAY is in, and marked. It is a holiday for the Tasmanian
//     State Service only, so the hospitals are affected by who is in while the
//     rest of us work. Treating it as a day off would be wrong; leaving it off
//     would lose the reason a list is short.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const CKAN = 'https://data.gov.au/data/api/3/action/package_show'
const DATASET = 'australian-holidays-machine-readable-dataset'

/** Where the answer came from, for the log and the admin card. */
export const SOURCES = { api: 'data.gov.au', fallback: 'checked-in file' }

/** Easter Tuesday, said the way it should be read. */
export const PUBLIC_SERVICE_NOTE = '(public service only, business as usual)'

/** Northern Tasmania. Never ours, whoever offers it. */
const RECREATION_DAY = /recreation\s*day/i
const EASTER_TUESDAY = /easter\s*tuesday/i
const REGATTA = /regatta/i

/** The second Monday in February, which is when the Regatta is. */
export function regattaDay(year) {
  const first = new Date(Date.UTC(year, 1, 1))
  const firstMonday = 1 + ((8 - first.getUTCDay()) % 7)
  return `${year}-02-${String(firstMonday + 7).padStart(2, '0')}`
}

/** 20260209 → 2026-02-09. The dataset writes dates without separators. */
function isoFrom(compact) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(compact || '').trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/**
 * Tidies a name into the one the calendar should carry.
 *
 * The dataset's own wording for Easter Tuesday is "Easter Tuesday - generally
 * Tasmanian Public Service only", which is accurate and not what anybody wants
 * to read across a calendar square.
 */
function titleFor(name) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim()
  if (EASTER_TUESDAY.test(clean)) return `Easter Tuesday ${PUBLIC_SERVICE_NOTE}`
  // "Anzac Day" in the dataset, "ANZAC Day" everywhere in Australia.
  return clean.replace(/\bAnzac\b/g, 'ANZAC')
}

/**
 * The Hobart rules, applied to a list of `{ date, name }`.
 *
 * Exported because it is the part worth testing on its own: the fetching is
 * plumbing and this is the decision.
 */
export function hobartRules(holidays, year) {
  const kept = (holidays || [])
    .filter(h => h?.date && h?.name)
    .filter(h => !RECREATION_DAY.test(h.name))
    .map(h => ({
      date: h.date,
      name: titleFor(h.name),
      // Said rather than inferred: a day the hospitals run normally is a
      // different kind of entry from one they do not.
      publicServiceOnly: EASTER_TUESDAY.test(h.name) || undefined
    }))

  // The Regatta, where the source did not carry it — which is every source so
  // far. Added rather than assumed: if one ever does supply it, this leaves it
  // alone rather than putting it in twice.
  if (year && !kept.some(h => REGATTA.test(h.name))) {
    kept.push({ date: regattaDay(year), name: 'Royal Hobart Regatta' })
  }

  const seen = new Set()
  return kept
    .filter(h => {
      if (seen.has(h.date + h.name)) return false
      seen.add(h.date + h.name)
      return true
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** The checked-in list, for a year the API cannot answer for. */
async function fromFile(year) {
  const here = dirname(fileURLToPath(import.meta.url))
  const path = join(here, '..', 'data', 'tas-holidays-2026-2027.json')
  const file = JSON.parse(await readFile(path, 'utf8'))
  const rows = file?.years?.[String(year)]
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error(`The checked-in file has no holidays for ${year}`)
  }
  return rows
}

/**
 * The dataset's resource for one year, as `{ date, name }` rows for Tasmania.
 *
 * Throws rather than returning empty, so the caller can tell "the API does not
 * know about this year" from "Tasmania has no holidays", which would be a
 * surprising thing to believe.
 */
async function fromApi(year, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${CKAN}?id=${encodeURIComponent(DATASET)}`)
  if (!res.ok) throw new Error(`CKAN package_show failed (${res.status})`)
  const body = await res.json()
  const resources = body?.result?.resources
  if (!Array.isArray(resources)) throw new Error('CKAN returned no resources')

  // "Australian Public Holidays 2025". Matched on the year in the name rather
  // than on the whole title, which has changed wording several times across
  // the years the dataset covers.
  const wanted = resources.find(r =>
    new RegExp(`\\b${year}\\b`).test(String(r?.name || ''))
    && /csv/i.test(String(r?.format || '')))
  if (!wanted?.url) throw new Error(`No ${year} resource in the dataset`)

  const csv = await fetchImpl(wanted.url)
  if (!csv.ok) throw new Error(`Could not read the ${year} resource (${csv.status})`)
  return parseHolidayCsv(await csv.text(), year)
}

/**
 * The Tasmanian rows of the dataset's CSV.
 *
 * Columns are Date,Holiday Name,Information,More Information,Jurisdiction, and
 * a holiday name can contain a comma — so this splits on quotes properly
 * rather than on every comma, which would shift the jurisdiction out of its
 * column and silently drop the lot.
 */
export function parseHolidayCsv(text, year) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return []

  const cells = line => {
    const out = []
    let cur = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i++ } else quoted = !quoted
      } else if (ch === ',' && !quoted) { out.push(cur); cur = '' } else cur += ch
    }
    out.push(cur)
    return out.map(c => c.trim())
  }

  const header = cells(lines[0]).map(h => h.toLowerCase())
  const at = name => header.findIndex(h => h === name)
  const dateAt = at('date')
  const nameAt = at('holiday name')
  const juris = at('jurisdiction')
  if (dateAt < 0 || nameAt < 0 || juris < 0) {
    throw new Error('The holiday CSV does not have the columns it used to')
  }

  return lines.slice(1)
    .map(cells)
    .filter(row => (row[juris] || '').toLowerCase() === 'tas')
    .map(row => ({ date: isoFrom(row[dateAt]), name: row[nameAt] }))
    .filter(h => h.date && h.name)
    .filter(h => !year || h.date.startsWith(String(year)))
}

/**
 * Hobart's public holidays for one year.
 *
 * Never throws for the ordinary reasons. A year the API cannot answer for is
 * expected — it cannot answer for any year after 2025 — so that falls through
 * to the file rather than failing the sync. It throws only when neither knows,
 * which is a year nobody has written down and is worth stopping for.
 *
 * @returns {Promise<{year:number, source:string, holidays:Array, apiError?:string}>}
 */
export async function hobartHolidays(year, { fetchImpl = fetch } = {}) {
  let apiError
  try {
    const rows = await fromApi(year, { fetchImpl })
    if (rows.length) {
      return { year, source: SOURCES.api, holidays: hobartRules(rows, year) }
    }
    apiError = `The dataset had no Tasmanian rows for ${year}`
  } catch (err) {
    apiError = err.message
  }

  const rows = await fromFile(year)
  return { year, source: SOURCES.fallback, holidays: hobartRules(rows, year), apiError }
}

/**
 * The Google event id for a holiday.
 *
 * Deterministic, so running the sync twice updates rather than duplicates.
 * Google allows base32hex — lowercase a-v and 0-9 — and "tmph" plus eight
 * digits is inside that and inside the five-character minimum.
 *
 * Keyed on the date alone, not the name. A holiday that gets renamed is the
 * same day off, and keying on the name would leave the old one behind.
 */
export function holidayEventId(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''))
  if (!m) throw new Error(`Not a date: ${isoDate}`)
  return `tmph${m[1]}${m[2]}${m[3]}`
}

/** The title that goes on the calendar. */
export function holidayTitle(holiday) {
  return `Public Holiday – ${holiday.name}`
}

/** The day after, which is what Google wants as an all-day end. */
export function dayAfter(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
