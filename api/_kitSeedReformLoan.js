// E4 Surgical's Reform loan set at Calvary (Brent, 21 Nov 2026: "There is
// currently a Loan Reform Set on its way … Pull the tray lists from that
// email from Roy at E4 and put that Loan kit into the Kit room under Reform
// as a loan set so it can be turned around"). Read from E4's loan set CSSD
// checklist that came with the set: eight trays, each with its photo (the
// numbers on a photo are the "#" in each line). Codes, descriptions and
// quantities only. Applied once by KIT_CORRECTIONS in _kits.js; the set is
// a distributor's loan set (kind 'loan') — it goes back to E4, never to us.
// The case it is held for is read from the calendar when the seed runs (the
// next Reform booking at Calvary), never written here.

const m = (ref, code, description, qty) => ({ code, description: ref ? `#${ref} ${description}` : description, qty, kind: 'instrument' })
const i = (ref, code, description, qty) => ({ ...m(ref, code, description, qty), kind: 'implant' })

export const REFORM_LOAN_KIT = {
  id: 'reform-e4-loan-clv', name: 'Reform E4 loan set', system: 'Reform Cervical',
  distributor: 'e4', kind: 'loan', home: 'CLV'
}

export const REFORM_LOAN_FILE = 'E4 Surgical loan set CSSD checklist — Reform POCT (Calvary, Nov 2026).pdf'

export const REFORM_LOAN_TRAYS = [
  { name: 'Reform 55.1a Drilling', photo: 'drilling', lines: [
    m(1, '55-IN-0020', 'Curved Sharp Probe (Gold)', 1),
    m(1, '55-IN-0010', 'Awl', 1),
    m(2, '55-IN-0048', 'Feeler', 1),
    m(3, '76-CR-0435', 'Blue Ring Drill (Do Not Discard) Alt: C2849-01', 2),
    m(4, '55-IN-1035', '3.5mm Adjustable Drill (2.2mm actual)', 2),
    m(5, 'C2824-35', '3.5 Tap with Adapter (Alt: 76-CR-0535)', 1),
    m(6, '55-IN-2040', '4.0mm Tap (3.5mm actual)', 1),
    m(6, '55-IN-2045', '4.5mm Tap (4.0mm actual)', 1),
    m(7, '55-IN-1352', '3.5 x 12mm Fixed Drill (2.2mm actual)', 2),
    m(7, '55-IN-1354', '3.5 x 14mm Fixed Drill (2.2mm actual)', 2),
    m(7, '55-IN-1356', '3.5 x 16mm Fixed Drill (2.2mm actual)', 1),
    m(6, '55-IN-2035', '3.5mm Tap (3.0mm actual)', 1),
    m(8, '55-IN-0060', 'Adjustment Driver', 1),
    m(9, '55-IN-0030', 'Fixed Drill Guide (cannulated)', 1),
    m(10, '55-IN-0050', 'Screwdriver (Do not disassemble)', 2),
    m(11, '55-CH-0001', 'Straight Handle (Spin Cap)', 2),
    m(12, '55-IN-0040', 'Adjustable Drill Guide (cannulated)', 1)
  ] },
  { name: 'Reform 55.1b Rod Manipulation', photo: 'rod', lines: [
    m(1, '55-IN-0114', 'Tower Reducer', 2),
    m(2, '55-CH-0003', 'Torque Handle (3.3Nm)', 1),
    m(3, '55-CH-0002', 'Ratchet Handle (cannulated)', 2),
    m(4, '55-IN-0122', 'Counter Torque (cannulated)', 1),
    m(5, '55-IN-0110', 'Rod Rocker', 1),
    m(6, '55-IN-0071', 'Rod Pusher', 1),
    m(7, '55-IN-0119', 'Set Screw Starter', 2),
    m(8, '55-IN-0067', 'Long Rod Template', 1),
    m(8, '55-IN-0066', 'Short Rod Template', 1),
    m(9, '55-IN-0118', 'Dual-Sided Set Screw Starter', 2),
    m(10, '55-IN-0121', 'Torque Drive Shaft', 1),
    m(11, '55-IN-0068', 'Rod Holder', 1),
    m(12, '55-IN-0100', 'Gun Reducer', 1),
    m(13, '55-IN-0061', 'Head Turner', 1),
    m(14, '55-IN-0713', 'In-Line Counter Torque', 1),
    m(15, 'C-3132', 'Torque Handle Black (Alt: 621343)', 1)
  ] },
  { name: 'Reform 55.2 Screws and Rods', photo: 'screws', lines: [
    ...[[10, 6], [12, 10], [14, 10], [16, 10], [18, 8], [20, 4], [22, 4], [24, 4], [26, 4], [28, 4], [30, 4], [35, 4], [40, 4]]
      .map(([len, qty]) => i(1, `55-PA-35${String(len).padStart(2, '0')}`, `3.5 x ${len}mm Screw`, qty)),
    ...[[10, 4], [12, 6], [14, 6], [16, 6], [18, 6], [20, 4], [22, 4], [24, 4], [26, 4], [28, 4], [30, 4], [35, 4], [40, 4]]
      .map(([len, qty]) => i(2, `55-PA-40${String(len).padStart(2, '0')}`, `4.0 x ${len}mm Screw`, qty)),
    ...[25, 30, 35, 40, 45, 50].map(len => i(3, `55-PA-45${len}`, `4.5 x ${len}mm Screw`, 4)),
    i(4, '55-LS-0100', 'Locking Caps', 20),
    ...[20, 22, 24, 26, 28, 30, 32, 34].map(len => i(5, `55-PB-35${len}`, `3.5 x ${len}mm Smooth Shank Green (16mm threaded)`, 2)),
    i(6, '55-PB-3522-L', '3.5 x 22mm Smooth Shank Pink (14mm threaded)', 2),
    i(6, '55-PB-3524', '3.5 x 24mm Smooth Shank Green (16mm threaded) — second caddy', 2),
    ...[[26, 18], [28, 20], [30, 22], [32, 24], [34, 26]].map(([len, thr]) => i(6, `55-PB-35${len}-L`, `3.5 x ${len}mm Smooth Shank Pink (${thr}mm threaded)`, 2)),
    ...[[20, ''], [25, ' (Alt: in purple screw caddy)'], [30, ''], [35, ' (Alt: in purple screw caddy)'], [40, ''], [50, ''], [60, ''], [70, ''], [80, '']]
      .map(([len, note]) => i(7, `55-ST-50${len}`, `3.5 x ${len}mm Rod${note}`, 2)),
    i(7, '55-ST-5120', '3.5 x 120mm Rod', 2),
    i(7, '55-LT-5060', '60mm Lordotic Rod (Alt: in purple screw caddy)', 2),
    i(7, '55-LT-5080', '80mm Lordotic Rod (in rod caddy)', 2),
    i(7, '55-LT-5100', '100mm Lordotic Rod (in rod caddy)', 2)
  ] },
  { name: 'Reform 55.3a Miscellaneous', photo: 'misc', lines: [
    m(1, 'E4-0505', 'MDT Adapter (Alt: E4-271021)', 2),
    m(2, 'E4-1097', 'BLB Adapter (Alt: E4-58752)', 2),
    m(3, '55-IN-0126', 'Head-to-Head Counter Torque', 1),
    m(4, '55-IN-0130', 'Cross Connector Calipers', 1),
    m(5, '55-IN-0138', 'Cross-Connector Driver', 1),
    i(6, '55-ST-5350', '3.5 x 350mm Straight Rod, Titanium', 2),
    m(7, '55-IN-0136', 'Head-to-Head Locking Cap Inserter', 1),
    m(8, 'C2825', 'Screwdriver with Adapter (White) (Alt: 76-CR-0700)', 1),
    m(9, 'C2850 or 76-CR-0040', 'Nav drill guide (C2850 for the C2849-01 drill only; 76-CR-0040 for the 76-CR-0435 drill only) (cannulated)', 1)
  ] },
  { name: 'Reform 55.3b Crosslinks', photo: 'crosslinks', lines: [
    ...[['0025', '25-27mm', 'Silver'], ['0027', '27-30mm', 'Pink'], ['0030', '30-36mm', 'Yellow'], ['0035', '35-46mm', 'Green'], ['0045', '45-66mm', 'Blue']]
      .map(([c, size, col]) => i(1, `55-CC-${c}`, `${size} Crosslink (${col})`, 1)),
    ...[['0025', '25-27mm', 'Silver'], ['0027', '27-30mm', 'Pink'], ['0030', '30-36mm', 'Yellow'], ['0035', '35-46mm', 'Green'], ['0045', '45-66mm', 'Blue']]
      .map(([c, size, col]) => i(2, `55-CH-${c}`, `${size} Head-to-Head Crosslink (${col})`, 1)),
    i(3, '55-LS-0301', 'Locking Nut', 6),
    i(4, '55-LS-0300', 'Tall Cap Screw', 6)
  ] },
  { name: 'Reform 55.3c Bending', photo: 'bending', lines: [
    m(1, '55-IN-0143', 'Distractor', 1),
    m(2, '55-IN-0142', 'Compressor', 1),
    m(3, '55-IN-0070', 'Rod Bender', 1),
    m(4, '55-IN-0081', 'In-Situ Bender Left', 1),
    m(5, '55-IN-0082', 'In-Situ Bender Right', 1),
    m(6, '55-IN-0090', 'Rod Cutter', 1)
  ] },
  { name: 'Reform 55.7 Medial Biased Screws', photo: 'medial', lines: [
    ...[[14, 10], [16, 6], [18, 4], [20, 2], [22, 2], [24, 2]]
      .map(([len, qty], n) => i(n + 1, `55-PM-35${len}`, `3.5 x ${len}mm Medially Biased Screw`, qty))
  ] },
  { name: 'Reform Thani Posterior Cervical', photo: 'cervical', lines: [
    m(1, '63-5738', 'A/O T-Handle Black', 2),
    m(2, 'E4-1119', 'Blue Ring Drill (Do Not Discard) (2.5mm) — Custom; check it says Technomed', 1),
    m(3, 'E4-1117', 'Navigate drill guide (3 parts)', 1)
  ] }
]

const safe = s => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)

/**
 * The next Reform booking at Calvary from `today`, within four weeks: the case
 * the loan set is held for. Read-only; null when the calendar says nothing.
 */
export async function nextReformCase({ today, fetchImpl = fetch } = {}) {
  const { getGoogleToken, CALENDAR_SCOPE_READONLY } = await import('./_googleCalendar.js')
  const { readBooking } = await import('../src/clinicalPlan/parse.js')
  const { getCalendarId } = await import('./_googleCalendar.js')
  const calendarId = getCalendarId()
  if (!calendarId) return null
  const token = await getGoogleToken(CALENDAR_SCOPE_READONLY)
  const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 28)
  const params = new URLSearchParams({ timeMin: `${today}T00:00:00+11:00`, timeMax: `${end.toISOString().slice(0, 10)}T23:59:59+11:00`, singleEvents: 'true', orderBy: 'startTime', maxResults: '500' })
  const res = await fetchImpl(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null
  return reformCaseFrom((await res.json()).items || [], readBooking, today)
}

/**
 * Pure: the next two live Calvary bookings whose kit names Reform, from
 * `today` — the case the set came for and the one it is turned around for —
 * as { surname, surgeon, caseDate, then }.
 */
export function reformCaseFrom(events, readBooking, today = '') {
  const found = []
  for (const e of events) {
    if (found.length === 2) break
    const date = String(e.start?.dateTime || e.start?.date || '').slice(0, 10)
    if (!date || date < today) continue
    const title = String(e.summary || '')
    if (/cancel/i.test(title)) continue
    let read = null
    try { read = readBooking(title, String(e.description || '')) } catch { read = null }
    if (!read) continue
    const kit = `${read.kit || ''} ${read.system || ''}`
    const where = `${read.hospital || ''} ${title} ${e.description || ''}`
    if (!/reform/i.test(kit) || !/calvary|\bclv\b/i.test(where)) continue
    found.push({ surname: String(read.patient || '').trim().split(/\s+/)[0] || '', surgeon: String(read.surgeon || ''), caseDate: date })
  }
  if (!found.length) return null
  return found[1] ? { ...found[0], then: found[1] } : found[0]
}

export async function runReformLoan(deps = {}) {
  const { redisSetBody } = deps.redisMod || await import('./_redis.js')
  const { getDefs, getTrayList, addHistory } = deps.kits || await import('./_kits.js')
  const upload = deps.upload || (await import('./_dropbox.js')).uploadFile
  const { PHOTOS } = deps.photos || await import('./_kitSeedReformLoanPhotos.js')
  const kit = REFORM_LOAN_KIT
  const by = 'Claude (E4 loan set checklist, Reform)'
  if ((await getTrayList(kit.id))?.trays?.some(t => (t.lines || []).length)) return null
  const trays = []
  for (const t of REFORM_LOAN_TRAYS) {
    let photo = null
    const data = PHOTOS[t.photo]
    const path = `/Tray Lists/Tray Photos/${kit.name}/${safe(t.name)}.jpg`
    for (let a = 0; data && a < 3; a += 1) {
      try { await upload(path, Buffer.from(data, 'base64')); photo = path; break } catch {
        await new Promise(r => setTimeout(r, process.env.VITEST ? 0 : 1500 * (a + 1)))
      }
    }
    trays.push({ name: t.name, file: REFORM_LOAN_FILE, ...(photo ? { photo } : {}), lines: t.lines })
  }
  await redisSetBody(`kits:list:${kit.id}`, JSON.stringify({ trays, source: { file: REFORM_LOAN_FILE, hospital: 'CLV', by, at: new Date().toISOString() } }))
  let heldFor = null
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Hobart' })
    heldFor = await (deps.nextCase || nextReformCase)({ today })
  } catch { heldFor = null }
  const defs = await getDefs()
  await redisSetBody('kits:defs', JSON.stringify(defs.map(k => (k.id === kit.id
    ? { ...k, trays: trays.map(t => t.name), ...(heldFor ? { heldFor } : {}) } : k))))
  await addHistory({ kind: 'edit', kitId: kit.id, kitName: kit.name, by,
    text: `E4 Reform loan set at Calvary, from E4's checklist: ${trays.map(t => t.name).join(', ')}` })
  return { kitId: kit.id, trays: trays.map(t => t.name), photos: trays.filter(t => t.photo).length, heldFor: Boolean(heldFor) }
}
