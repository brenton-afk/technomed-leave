import { streamClaude } from './_anthropic.js'

// ─── Reading a tray list ─────────────────────────────────────────────────────
// "We will ask the hospital for digital copies of the trays that live at the
// hospital on consignment and upload them to the portal so we always have
// record of what trays are where when we move trays and when we open trays.
// This will also mean we can perform real time stock takes." — Brent, 2 Nov
//
// The lists come as Word documents (ours, in Dropbox: TECHNOMED/Tray Lists),
// PDFs and photographs (the hospitals'), and the odd spreadsheet. Every one is
// laid out differently, so the model reads it and a person checks what it
// read before anything is saved — the same shape as reading a booking.
//
// Where the hospital's copy and our master list differ, the hospital's wins for
// a tray that lives at that hospital: it is the list they count against.
//
// Two kinds of line, because they are counted differently (Brent's call):
//   implant     implants, consumables, anything that is used up and restocked —
//               counted, the number goes down with usage and up with restock
//   instrument  everything that comes back — ticked present or missing

// A transcription job, not a judgement one: the fast model reads a table as
// well as the careful one and in a fraction of the time ("uploading tray lists
// is super slow"). Falls back to the usage model if this one is refused.
const MODEL = process.env.TRAY_LIST_MODEL || 'claude-sonnet-5-5'
const FALLBACK_MODEL = process.env.USAGE_VISION_MODEL || 'claude-opus-5'

export const MAX_TRAYS = 30
export const MAX_LINES = 400

const PROMPT = `This is a surgical instrument and implant tray list (set list) for a spinal implant distributor. It may cover one tray or several.

Return every tray and every line on it, in the order printed. For each line:
  code         the reference / catalogue / material number exactly as printed, or ""
  description  the item description as printed
  qty          the quantity the tray should hold (the "Qty" or "Par" column), a number
  kind         "implant" for implants, consumables, screws, plates, cages, rods, set screws, caps, pins, guide wires and anything single use; "instrument" for everything else

Ignore columns for lot numbers, "TM Out", "Hosp In", "Hosp Out", signatures, page footers, phone numbers and picture placeholders. Do not invent lines or quantities: if a quantity is not printed, use 1 for an instrument and 0 for an implant.

A tray heading looks like "TRAY 1 - INSTRUMENTS", "Tray 4 - 10 Degree Trials", "DNO TRAY", or a caddy name. If the document has no headings, it is one tray: name it after the document's title.

Photographs appear in the text as markers like [PHOTO 3] (or, when you are given images, as the images themselves, numbered 1, 2, 3 in the order given). A marker marked "— large" is drawn big on the page. There are two kinds:
  - the tray photograph, showing the WHOLE tray — usually large, the first photograph where the tray starts, just under or beside its heading. Set the tray's "photo" to its number, or null if there is none. Never give two trays the same photo unless the document clearly shows one picture for both.
  - item pictures: hospital check sheets (e.g. "CSSD Check Sheet") and some of our lists show a small picture of an item in its row (an "Image" column). An item picture's marker comes straight after the line of its row. Give that line the picture's number as a fifth value. A row with no picture has no fifth value. Never use the tray photograph as an item picture, and never give two lines the same picture.

Return ONLY JSON, with each line as a short array [code, description, qty, kind] — or [code, description, qty, kind, photo] when the row has its own picture — where kind is "i" for implant or "m" for instrument; the list is long, so keep it compact:
{"title":"","trays":[{"name":"","photo":1,"lines":[["2SEA-86-0052","ANGLED AWL 10MM",1,"m"],["CZ0001","INSERTER CAGE",2,"m",4]]}]}`

/** What kind of file this is, from its name and type. */
export function fileKind(filename, mediaType = '') {
  const ext = String(filename || '').toLowerCase().split('.').pop()
  if (ext === 'docx' || /wordprocessingml/.test(mediaType)) return 'docx'
  if (ext === 'xlsx' || /spreadsheetml/.test(mediaType)) return 'xlsx'
  if (ext === 'pdf' || mediaType === 'application/pdf') return 'pdf'
  if (['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext) || /^image\//.test(mediaType)) return 'image'
  return null
}

async function textOf(buffer, kind) {
  if (kind === 'docx') {
    const { default: mammoth } = await import('mammoth')
    return (await mammoth.extractRawText({ buffer })).value
  }
  if (kind === 'xlsx') {
    const { default: ExcelJS } = await import('exceljs')
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(buffer)
    const out = []
    book.eachSheet(sheet => {
      out.push(`## ${sheet.name}`)
      sheet.eachRow(row => {
        const cells = (row.values || []).slice(1).map(v => (v && typeof v === 'object' ? (v.text ?? v.result ?? '') : v ?? ''))
        if (cells.some(c => String(c).trim())) out.push(cells.join(' | '))
      })
    })
    return out.join('\n')
  }
  return null
}

const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0 }
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/** The model's answer, held to a shape the kit room can trust. */
export function cleanTrays(parsed) {
  const trays = (parsed?.trays || []).slice(0, MAX_TRAYS).map((t, i) => ({
    name: clip(t?.name, 80) || `Tray ${i + 1}`,
    photo: Number.isInteger(Number(t?.photo)) && Number(t.photo) > 0 ? Number(t.photo) : null,
    lines: (t?.lines || []).slice(0, MAX_LINES).map(l => (Array.isArray(l)
      ? { code: l[0], description: l[1], qty: l[2], kind: l[3], photo: l[4] }
      : l)).map(l => ({
      code: clip(l?.code, 40),
      description: clip(l?.description, 120),
      qty: num(l?.qty),
      kind: l?.kind === 'implant' || l?.kind === 'i' ? 'implant' : 'instrument',
      // The item's own picture, from the row it was printed in.
      ...(Number.isInteger(Number(l?.photo)) && Number(l.photo) > 0 ? { photo: Number(l.photo) } : {})
    })).filter(l => l.code || l.description)
  })).filter(t => t.lines.length)
  // An item picture is never a tray's photograph, and is one row's only.
  const trayPhotos = new Set(trays.map(t => t.photo).filter(Boolean))
  const used = new Set()
  for (const t of trays) {
    for (const l of t.lines) {
      if (!l.photo) continue
      if (trayPhotos.has(l.photo) || used.has(l.photo)) delete l.photo
      else used.add(l.photo)
    }
  }
  // Two trays printed with the same heading would collide as names.
  const seen = new Map()
  for (const t of trays) {
    const n = (seen.get(t.name) || 0) + 1
    seen.set(t.name, n)
    if (n > 1) t.name = `${t.name} (${n})`
  }
  return { title: clip(parsed?.title, 120), trays }
}

/**
 * A tray list file, read into trays and lines for a person to check.
 *
 * `text` instead of a file when the phone has already pulled the words out of
 * a Word document — those run to 15MB of photographs around a few KB of table.
 */
export async function readTrayList(buffer, filename, mediaType, { text: given, images } = {}) {
  if (Array.isArray(images) && images.length) {
    // Pages or photos the phone has already drawn and shrunk.
    const content = images.slice(0, 12).map(img => ({
      type: 'image',
      source: { type: 'base64', media_type: /png/.test(img?.mediaType) ? 'image/png' : 'image/jpeg', data: String(img?.data || '') }
    })).filter(b => b.source.data)
    if (!content.length) throw new Error('Nothing came through to read — try again.')
    content.push({ type: 'text', text: `File: ${filename}` })
    return askForTrays(content)
  }
  const kind = given != null ? 'text' : fileKind(filename, mediaType)
  if (!kind) throw new Error('That file type cannot be read. Use a PDF, Word document, spreadsheet or photo.')

  const content = []
  const text = given != null ? String(given) : await textOf(buffer, kind)
  if (text != null) {
    if (!text.trim()) throw new Error('That document has no text in it to read.')
    content.push({ type: 'text', text: `File: ${filename}\n\n${text.slice(0, 120000)}` })
  } else if (kind === 'pdf') {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } })
  } else {
    const media = /png$/i.test(filename) ? 'image/png' : /webp$/i.test(filename) ? 'image/webp' : 'image/jpeg'
    content.push({ type: 'image', source: { type: 'base64', media_type: media, data: buffer.toString('base64') } })
  }
  return askForTrays(content)
}

async function askForTrays(content) {
  content.push({ type: 'text', text: PROMPT })

  const ask = model => streamClaude({
    feature: 'tray-list',
    whenUnavailable: 'The tray list could not be read automatically right now — try again shortly.',
    timeoutMs: 100000,
    request: { model, max_tokens: 32000, messages: [{ role: 'user', content }] }
  })
  let reply
  try {
    reply = await ask(MODEL)
  } catch (err) {
    // A model this account does not have is a setting, not an outage.
    if (!/model/i.test(String(err?.detail || err?.message || '')) || MODEL === FALLBACK_MODEL) throw err
    reply = await ask(FALLBACK_MODEL)
  }
  const out = (reply.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  const json = /\{[\s\S]*\}/.exec(out)
  if (!json) throw new Error('The tray list could not be read — check it is a tray list and try again.')
  let parsed
  try { parsed = JSON.parse(json[0]) } catch {
    // A cut-off answer is a partial list, and a partial list is worse than
    // none: somebody would count against it.
    throw new Error('The tray list was too long to read in one go — split it into smaller files.')
  }
  const result = cleanTrays(parsed)
  if (!result.trays.length) throw new Error('No trays were found in that file.')
  return result
}
