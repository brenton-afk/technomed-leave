import { streamClaude } from '../_anthropic.js'
import { requireSession } from '../_auth.js'
import { markAttendance } from '../_googleCalendar.js'
import { STAFF, firstNameFor } from '../../src/staffConfig.js'
import {
  saveUsageRecord, getUsageRecord, getUsageHistory,
  setUsageReviewed, getUsageReviews,
  claimResupply, saveResupply, getResupply, getCaseResupplies, removeUsageRecord,
  claimUsageSend, releaseUsageSend, releaseResupply
} from '../_redis.js'
import {
  RESUPPLY_PROMPT, normaliseResupply, candidateCases, compareResupply,
  resupplyFileName, itemsFor
} from '../_resupply.js'
import { normaliseCase, recomputeCase, normaliseItem } from '../_usageCase.js'
import { DISTRIBUTORS, groupByDistributor, ccFor } from '../_distributors.js'
import { buildUsageWorkbook } from '../_usageExcel.js'
import { buildScanPdf } from '../_usagePdf.js'
import {
  caseFolderPath, saveUsageFiles, dropboxConfigured,
  listFolder, temporaryLink, resourcesRoot, usageRoot, patientHistory, uploadFile, caseFoldersOnDay
} from '../_dropbox.js'
import { amendItems, changesByDistributor } from '../_usageAmend.js'
import { earlierSends } from '../_usageRepeat.js'
import { findDuplicate, freeFolderName } from '../_usageDuplicate.js'
import { sendUsageEmail } from '../_email.js'

// Usage scanning lives in this one function, routed by ?action=, for the same
// reason as api/meetings/agent.js: Vercel's Hobby plan caps a deployment at 12
// serverless functions and the app is at that ceiling. The four actions below
// are the four endpoints from the spec — scan, save, email, list.
//
// Patient data passes through here. Two rules hold throughout: nothing
// extracted is ever written to a log, and no route runs without a session.

const VISION_MODEL = process.env.USAGE_VISION_MODEL || 'claude-opus-5'
const MAX_PAGES = 8
const ACCEPTED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

const EXTRACTION_PROMPT = `You are a surgical implant usage extraction specialist. Analyse this hospital usage document carefully. Extract every implant sticker and handwritten entry. For each item identify: distributor/manufacturer, product name, reference/catalogue code, lot number, size/dimensions, quantity used, rebate code if present. Also extract: patient surname, surgeon name, date, hospital (CLV or RHH), procedure description, rep name. Do NOT extract the patient's first name, UR number, date of birth or any other identifier, even where they are legible on the label — the surname is the only patient identifier this system holds. A surname can be more than one word (\"Van der Berg\", \"Lloyd Jones\"): return all of it. EXCLUDE entirely — do not list them at all: Floseal, TachoSil, Gelfoam (gel foam), Surgicel, Spongistan and other haemostatic/peripheral products that are not implants. Flag any handwritten items that cannot be clearly identified as MANUAL REVIEW REQUIRED. Return structured JSON.

The document is a "Record of Implantable/Rebatable Items Used" form from Calvary Health Care Tasmania (CLV) or Royal Hobart Hospital (RHH). It mixes printed implant stickers with handwritten quantities ("x1", "x3", "×4"), handwritten product names, a printed patient ID label, and a handwritten date, procedure and rep name.

Accuracy matters more than completeness of detail. Never invent a value: if a field is not legible, return an empty string for it. If you are not confident you have read an item correctly, set "confidence" to "low" and "manualReview" to true rather than guessing — a human will check every flagged row.

Return ONLY a JSON object (no markdown fences, no preamble, no trailing commentary) of exactly this shape:
{
  "patientSurname": "",
  "surgeonName": "",
  "date": "YYYY-MM-DD, or the raw text if you cannot resolve it",
  "hospital": "CLV or RHH or empty string",
  "procedure": "",
  "repName": "",
  "items": [
    {
      "distributor": "manufacturer or distributor as printed, else empty",
      "productName": "",
      "referenceCode": "",
      "lotNumber": "",
      "size": "",
      "quantity": "as written, e.g. x1",
      "rebateCode": "",
      "description": "",
      "notes": "anything ambiguous a human should check",
      "handwritten": true,
      "confidence": "high | medium | low",
      "manualReview": false
    }
  ]
}
If the document contains no implant items, return an empty items array.`

export default async function handler(req, res) {
  const action = req.query.action

  // Every action touches patient or case data — authenticate first, always.
  const session = await requireSession(req, res)
  if (!session) return

  try {
    if (action === 'scan') return await handleScan(req, res, session)
    if (action === 'save') return await handleSave(req, res, session)
    if (action === 'email') return await handleEmail(req, res, session)
    if (action === 'list') return await handleList(req, res)
    if (action === 'files') return await handleFiles(req, res)
    if (action === 'open') return await handleOpen(req, res)
    if (action === 'history') return await handleHistory(req, res)
    if (action === 'reviewed') return await handleReviewed(req, res, session)
    if (action === 'record') return await handleRecord(req, res)
    if (action === 'amend') return await handleAmend(req, res, session)
    if (action === 'remove-duplicate') return await handleRemoveDuplicate(req, res, session)
    if (action === 'resupply-read') return await handleResupplyRead(req, res)
    if (action === 'resupply-compare') return await handleResupplyCompare(req, res)
    if (action === 'resupply-save') return await handleResupplySave(req, res, session)
    if (action === 'resupply-owing') return await handleResupplyOwing(req, res)
    return res.status(400).json({ error: 'Unknown or missing action' })
  } catch (err) {
    // err.message here is ours or the provider's; extracted content is never
    // interpolated into an error, so this cannot leak patient data.
    console.error(`usage/${action} failed:`, err.message)
    return res.status(err.status || 500).json({ error: err.message })
  }
}

// A fault in what the client sent, not a server failure — surfaces as 4xx.
function badRequest(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

// ─── Page validation ───────────────────────────────────────

function validatePages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw badRequest('Add at least one page before processing')
  }
  if (pages.length > MAX_PAGES) {
    throw badRequest(`A maximum of ${MAX_PAGES} pages can be processed at once`)
  }
  return pages.map((page, i) => {
    const mediaType = String(page?.mediaType || '').toLowerCase()
    if (!ACCEPTED_MEDIA.includes(mediaType)) {
      throw badRequest(`Page ${i + 1} is not a supported format (JPEG, PNG, WebP or PDF)`)
    }
    if (typeof page.data !== 'string' || page.data.length < 32) {
      throw badRequest(`Page ${i + 1} is empty or unreadable`)
    }
    return { mediaType, data: page.data }
  })
}

// ─── scan: vision extraction ───────────────────────────────

function contentBlocksFor(pages) {
  return pages.map(page => (
    page.mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: page.data } }
      : { type: 'image', source: { type: 'base64', media_type: page.mediaType, data: page.data } }
  ))
}

// The model is asked for bare JSON. Tolerate a stray fence or surrounding prose
// rather than failing the whole scan on formatting.
function parseExtraction(text) {
  const cleaned = String(text || '').replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw badRequest('The document could not be read. Try a clearer, better-lit photo.')
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    throw new Error('The extracted data was malformed. Please retry the scan.')
  }
}

// ─── Reading faster (Brent, 6 Nov 2026: "can we cut it to 15-20 seconds?") ──
// It took a minute or more because the whole form went in one request at the
// highest thinking effort. Now each page is read in its own request, all at
// the same time, at medium effort — the wait is the slowest page, not the sum —
// and a page whose answer cannot be used is read again at full effort.
// USAGE_FAST=off in Vercel puts back the single full-effort read;
// USAGE_VISION_EFFORT sets the first-pass effort.

const FAST = process.env.USAGE_FAST !== 'off'
const FIRST_EFFORT = process.env.USAGE_VISION_EFFORT || 'medium'
const HEADER_FIELDS = ['patientSurname', 'surgeonName', 'date', 'hospital', 'procedure', 'repName']

async function readOnce(pages, effort, note = '') {
  // Streaming so a long extraction cannot trip the HTTP request timeout.
  const message = await streamClaude({
    feature: 'usage-scan',
    whenUnavailable: 'The scan could not be read right now — the form can still '
      + 'be entered by hand, or try again shortly.',
    request: {
      model: VISION_MODEL,
      max_tokens: 16000,
      output_config: { effort },
      messages: [{
        role: 'user',
        content: [...contentBlocksFor(pages), { type: 'text', text: EXTRACTION_PROMPT + note }]
      }]
    }
  })
  if (message.stop_reason === 'refusal') {
    throw new Error('The document could not be processed. Please contact Brenton.')
  }
  const textBlock = message.content.find(b => b.type === 'text')
  if (!textBlock) throw new Error('No data was returned from the document')
  return { extracted: parseExtraction(textBlock.text), truncated: message.stop_reason === 'max_tokens' }
}

/**
 * One form from its pages' readings: the header from the first page that has
 * each field, the items from every page in page order.
 */
export function mergeExtractions(readings) {
  const merged = { items: [] }
  for (const field of HEADER_FIELDS) {
    merged[field] = readings.map(r => r?.[field]).find(v => String(v || '').trim()) || ''
  }
  for (const r of readings) merged.items.push(...(Array.isArray(r?.items) ? r.items : []))
  return merged
}

async function readForm(pages) {
  if (!FAST) return readOnce(pages, 'high')
  const readPage = async (page, i) => {
    const note = pages.length > 1
      ? `\n\nThis image is page ${i + 1} of ${pages.length} of one form. Return the header fields only where they are visible on this page, and every item on this page.`
      : ''
    try {
      const first = await readOnce([page], FIRST_EFFORT, note)
      if (first.truncated) return readOnce([page], 'high', note)
      return first
    } catch (err) {
      // An answer that could not be used is read again, properly. A refusal or
      // an unavailable service is not retried — it would only fail twice.
      if (err.name === 'AiUnavailable' || /could not be processed/.test(err.message)) throw err
      return readOnce([page], 'high', note)
    }
  }
  const readings = await Promise.all(pages.map(readPage))
  return {
    extracted: mergeExtractions(readings.map(r => r.extracted)),
    truncated: readings.some(r => r.truncated)
  }
}

/**
 * The name this person is known by, from the roster.
 *
 * Taken from staffConfig rather than split off the full name: Brenton is Brent and
 * Matthew is Mat, and the calendar has to match what the team already writes there
 * by hand.
 */
async function handleScan(req, res, session) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.ANTHROPIC_API_KEY) {
    throw badRequest(
      'Scanning is not switched on yet: ANTHROPIC_API_KEY is missing from this '
      + 'deployment. An admin needs to add it in Vercel (Settings → Environment '
      + 'Variables → Production) and then redeploy. Admins can confirm what is '
      + 'configured at /api/xero/info?action=env'
    )
  }

  const pages = validatePages(req.body?.pages)

  const { extracted, truncated } = await readForm(pages)
  const caseRecord = normaliseCase(extracted, {
    // The device's own date. The server has none to offer: Vercel runs in UTC, so
    // through a Hobart evening its "today" is already tomorrow here, and a case
    // scanned at 8pm would be filed under the wrong day.
    scanDate: req.body?.scanDate,
    repName: session.name,
    repEmail: session.email
  })

  return res.status(200).json({
    case: caseRecord,
    pageCount: pages.length,
    truncated
  })
}

// ─── save: Dropbox + Redis ─────────────────────────────────

async function handleSave(req, res, session) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const pages = validatePages(req.body?.pages)
  const incoming = req.body?.case
  if (!incoming) throw badRequest('No case data supplied')

  // Recompute rather than trusting the client: the rep may have corrected the
  // surname, surgeon or distributor on the review screen.
  const caseRecord = recomputeCase({ ...incoming, repName: session.name, repEmail: session.email })

  // Saving again over a case already on file (a test send, then the real one)
  // keeps what the server knows about it: which distributors have had it,
  // who scanned it first, when, and its corrections. These came from the
  // client before, and a phone holding an older copy wiped the record of a
  // send — after which the next Send went to everybody again.
  const stored = incoming.id ? await getUsageRecord(incoming.id) : null
  if (stored?.removed) {
    return res.status(410).json({ error: 'This scan was removed as a duplicate, so it cannot be saved again. Start a new scan if it is a different case.' })
  }
  const realSends = (stored?.emailsSent || []).filter(e => e && e.ok && !e.test && !e.testOnly)
  // Once a distributor has had it, the case name is what their email was
  // titled; renaming the folder now would file it apart from what they hold.
  if (realSends.length && stored.folderName) caseRecord.folderName = stored.folderName

  const blocking = []
  if (!caseRecord.patientSurname) blocking.push('patient surname')
  if (!caseRecord.date) blocking.push('date')
  if (!caseRecord.surgeonSurname) blocking.push('surgeon')
  if (!caseRecord.hospital) blocking.push('hospital (CLV or RHH)')
  if (blocking.length) {
    return res.status(400).json({ error: `Complete these before saving: ${blocking.join(', ')}` })
  }

  const included = caseRecord.items.filter(i => !i.excluded)
  if (included.length === 0) throw badRequest('There are no items to save')

  // Already filed? (api/_usageDuplicate.js — the Matthews double-up.) The
  // portal's own records and the Dropbox case folders for this patient and
  // day, before anything is written. A duplicate is not filed and not sent;
  // the rep sees what was filed and decides. Only "this is a different case"
  // files it — under a name that cannot be an existing folder.
  const records = await getUsageHistory(300)
  let folders = []
  if (dropboxConfigured()) {
    try { folders = await caseFoldersOnDay(caseRecord) } catch { /* the records still answer */ }
  }
  const duplicate = findDuplicate({ ...caseRecord, id: incoming.id }, records, folders)
  if (duplicate && !req.body?.confirmSeparate) {
    return res.status(409).json({ error: 'duplicate', duplicate })
  }
  if (duplicate) {
    const taken = [...folders, ...records
      .filter(r => String(r.patientSurname || '').toLowerCase() === String(caseRecord.patientSurname).toLowerCase()
        && r.date === caseRecord.date)
      .map(r => r.folderName)]
    caseRecord.folderName = freeFolderName(caseRecord.folderName, taken)
  }

  const folderPath = caseFolderPath(caseRecord)
  const [scanPdf, usageSheet] = await Promise.all([
    buildScanPdf(pages),
    // The Dropbox copy: every distributor's items together, and the only place
    // that records who scanned it and which rows never left the building.
    buildUsageWorkbook(caseRecord, included, { internal: true })
  ])

  // Dropbox is optional. Where it is configured it goes first, so a filing
  // failure leaves nothing recorded and nothing emailed and the rep can simply
  // retry. Where it is not configured the case still records and still emails —
  // the distributor's sheet travels as the email attachment either way.
  let saved = []
  let dropboxSkipped = false
  if (dropboxConfigured()) {
    ;({ saved } = await saveUsageFiles({
      folderPath,
      folderName: caseRecord.folderName,
      scanPdf,
      usageSheet
    }))
  } else {
    dropboxSkipped = true
  }

  const record = {
    ...caseRecord,
    id: incoming.id || `${Date.now()}-${(caseRecord.patientSurname || 'case').toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    dropboxPath: dropboxSkipped ? '' : folderPath,
    dropboxSkipped,
    filesSaved: saved,
    emailsSent: stored?.emailsSent || [],
    ...(stored?.amendments ? { amendments: stored.amendments } : {}),
    createdByEmail: stored?.createdByEmail || session.email,
    createdAt: stored?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  await saveUsageRecord(record)

  const groups = groupByDistributor(record.items)
  const heldBack = record.items.filter(i => !i.excluded && (i.manualReview || !i.distributorKey))

  // Records on the bookings calendar that this rep was at the case. In its own
  // try/catch and reported rather than thrown, exactly like the leave side
  // effects: the usage is filed and the sheet is going out either way, and a
  // calendar that would not accept a title change must not cost the scan.
  let attendance = { updated: false, reason: 'not attempted' }
  try {
    attendance = await markAttendance({
      date: record.date,
      patientSurname: record.patientSurname,
      firstName: firstNameFor(session.email)
    })
  } catch (err) {
    attendance = { updated: false, reason: err.message }
  }

  return res.status(200).json({
    record,
    dropboxPath: dropboxSkipped ? '' : folderPath,
    dropboxSkipped,
    filesSaved: saved,
    attendance,
    readyToEmail: [...groups.keys()].map(key => ({
      key,
      name: DISTRIBUTORS[key].name,
      itemCount: groups.get(key).length
    })),
    heldBackCount: heldBack.length
  })
}

// ─── email: one per distributor ────────────────────────────

async function handleEmail(req, res, session) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { usageId, only, testOnly, pages, confirmRepeat } = req.body || {}
  if (!usageId) throw badRequest('No usage record specified')

  const record = await getUsageRecord(usageId)
  if (!record) return res.status(404).json({ error: 'Usage record not found' })
  if (record.removed) return res.status(410).json({ error: 'This scan was removed as a duplicate — nothing was sent.' })
  // A saved case is the precondition, not a Dropbox path — Dropbox may be
  // deliberately switched off.
  if (!record.submittedAt && !record.createdAt) {
    return res.status(409).json({ error: 'Save the case before sending usage emails' })
  }

  const groups = groupByDistributor(record.items)
  if (groups.size === 0) {
    return res.status(400).json({ error: 'No items are ready to send — resolve the flagged rows first' })
  }

  // `only` lets the rep retry a single distributor that failed earlier.
  const targets = only?.length ? [...groups.keys()].filter(k => only.includes(k)) : [...groups.keys()]

  // A test send goes to whoever is signed in, and to nobody else.
  //
  // The address is taken from the session and never from the request, which is
  // the whole point: this attaches a workbook of patient identifiers, so an
  // endpoint that emailed it to an address supplied by the caller would be a way
  // to walk that data out of the building with one valid staff login. There is no
  // way to name a recipient here — only to say "me".
  const test = Boolean(testOnly)
  const cc = test ? [] : ccFor(session.email)

  // The scanned form, merged into one PDF, built here from the pages sent with
  // this request.
  //
  // They come with the request rather than out of storage because nothing stores
  // them: the record holds the transcription, not the photographs, and the PDF
  // built during save goes to Dropbox and is discarded. Sending them again is a
  // second upload of a payload the app has already sized for, and it means the
  // scan reaches the distributor whether or not Dropbox is connected — which was
  // the point of asking.
  //
  // Absent, the sheet still goes out on its own. A retry after the app has been
  // reloaded has no pages to send, and a usage sheet with no scan is worth more
  // than no email at all — but the result says which was sent, so nobody assumes
  // the form went when it did not.
  let scanPdf = null
  let scanError = ''
  if (Array.isArray(pages) && pages.length) {
    try {
      scanPdf = await buildScanPdf(validatePages(pages))
    } catch (err) {
      scanError = err.message
    }
  }

  const results = []

  // The same patient's usage on the same day, already sent to a distributor
  // from another case (see api/_usageRepeat.js), is held back unless the rep
  // has said to send it anyway. A test always goes — it goes only to them.
  const repeats = test || confirmRepeat
    ? new Map()
    : earlierSends(record, targets, await getUsageHistory(200))

  // Distributors this very case has already gone to. Sending again is the
  // double-up Device cannot tell from a second usage, so it is held like a
  // repeat from another case, and released the same way.
  const alreadySent = new Map(test || confirmRepeat ? [] : (record.emailsSent || [])
    .filter(e => e && e.ok && !e.test && !e.testOnly)
    .map(e => [e.key, e]))

  for (const key of targets) {
    const distributor = DISTRIBUTORS[key]
    const done = alreadySent.get(key)
    if (done) {
      results.push({
        key, name: distributor.name, to: [], itemCount: groups.get(key).length, ok: false, held: true,
        earlier: { sentAt: done.sentAt, sameCase: true },
        error: `Not sent: ${distributor.name} already had this usage`
          + `${done.sentAt ? ` (sent ${new Date(done.sentAt).toLocaleTimeString('en-AU', { timeZone: 'Australia/Hobart', hour: 'numeric', minute: '2-digit' })})` : ''}.`
          + ' If something changed, use Amend to send a correction.'
      })
      continue
    }
    if (!test && !(await claimUsageSend(record.id, key))) {
      results.push({
        key, name: distributor.name, to: [], itemCount: groups.get(key).length, ok: false, held: true,
        error: `Not sent: ${distributor.name} is already being sent from another tap or phone. Check Past scans in a minute.`
      })
      continue
    }
    const earlier = repeats.get(key)
    if (earlier) {
      if (!test) await releaseUsageSend(record.id, key)
      results.push({
        key, name: distributor.name, to: [], itemCount: groups.get(key).length, ok: false, held: true,
        earlier,
        error: `Not sent: ${distributor.name} already had this patient's usage for this day`
          + `${earlier.sentAt ? ` (sent ${new Date(earlier.sentAt).toLocaleTimeString('en-AU', { timeZone: 'Australia/Hobart', hour: 'numeric', minute: '2-digit' })})` : ''}.`
          + ' If something was missed, use Amend on the earlier scan instead.'
      })
      continue
    }
    const items = groups.get(key)
    const to = test ? [session.email] : distributor.to
    try {
      const xlsx = await buildUsageWorkbook(record, items)
      const sent = await sendUsageEmail({
        to,
        cc,
        subject: record.folderName,
        caseId: record.id,
        distributorLabel: distributor.name,
        xlsx,
        xlsxFilename: `${record.folderName}_Usage_Sheet.xlsx`,
        scanPdf,
        scanPdfFilename: `${record.folderName}_Scan.pdf`,
        test: test ? { wouldSendTo: distributor.to } : undefined,
        // Sent as the rep, and replies come back to them.
        sender: { name: session.name, email: session.email }
      })
      results.push({
        key, name: distributor.name, to, itemCount: items.length, ok: true, test,
        from: sent?.from || session.email,
        scanAttached: Boolean(scanPdf),
        sentAt: new Date().toISOString()
      })
    } catch (err) {
      results.push({ key, name: distributor.name, to, itemCount: items.length, ok: false, test, error: err.message })
    }
    if (!test) await releaseUsageSend(record.id, key)
  }

  // A test is not recorded against the case. Otherwise it would show as sent, and
  // the distributor would never get the real one — a test that quietly satisfies
  // the thing it was testing is worse than no test.
  // Merged onto the record as it is now, not as it was when the sends began:
  // an Amend or another send finished meanwhile is kept, not overwritten.
  // A held result never replaces a send that went.
  const fresh = test ? record : (await getUsageRecord(record.id)) || record
  const updated = test
    ? record
    : (() => {
      const recorded = results.filter(r => !(r.held && (fresh.emailsSent || []).some(e => e.key === r.key && e.ok)))
      // Keep the latest outcome per distributor so a retry replaces the failure.
      const merged = [...(fresh.emailsSent || [])].filter(e => !recorded.some(r => r.key === e.key))
      return { ...fresh, emailsSent: [...merged, ...recorded], updatedAt: new Date().toISOString() }
    })()
  if (!test) await saveUsageRecord(updated)

  const failed = results.filter(r => !r.ok)
  return res.status(failed.length && failed.length === results.length ? 502 : 200).json({
    results,
    test,
    scanAttached: Boolean(scanPdf),
    // Said out loud when the form could not be attached, rather than leaving its
    // absence to be noticed by the distributor.
    scanError: scanError || (scanPdf ? '' : 'the scanned pages were not sent with this request'),
    // Said back explicitly, so the app can show where it actually went rather
    // than assume.
    sentTo: test ? session.email : undefined,
    allSent: failed.length === 0,
    record: updated
  })
}

// ─── record / amend: correcting a usage after it has gone ────
// See api/_usageAmend.js. `record` returns one saved usage for the amend screen
// (and the distributors a new item can be routed to). `amend` with
// `preview: true` only says what would change; without it, it saves the
// corrected record, files the corrected sheet beside the original in Dropbox,
// and sends a correction to each distributor whose items changed — no one
// else. A test send goes to the signed-in person only and saves nothing.

async function handleRecord(req, res) {
  const record = await getUsageRecord(String(req.query.id || ''))
  if (!record) return res.status(404).json({ error: 'Usage record not found' })
  return res.status(200).json({
    record,
    distributors: Object.entries(DISTRIBUTORS).map(([key, d]) => ({ key, name: d.name }))
  })
}

async function handleAmend(req, res, session) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { usageId, items, preview, testOnly } = req.body || {}
  const record = await getUsageRecord(String(usageId || ''))
  if (!record) return res.status(404).json({ error: 'Usage record not found' })
  if (!Array.isArray(items)) throw badRequest('No items supplied')

  const amended = recomputeCase({ ...record, items: amendItems(record.items || [], items, normaliseItem) })
  // The case keeps its name: adding Boost would otherwise relabel the
  // procedure, and the correction would arrive under a different subject from
  // the usage it corrects, in a different folder.
  if (record.folderName) amended.folderName = record.folderName
  const changes = changesByDistributor(record.items || [], amended.items)
  if (preview) return res.status(200).json({ changes })
  if (!changes.length) throw badRequest('Nothing has changed for any distributor')

  const test = Boolean(testOnly)
  const now = new Date().toISOString()
  const n = (record.amendments || []).length + 1
  const groups = groupByDistributor(amended.items)

  // The corrected internal sheet, beside the original — never over it.
  let filed = ''
  if (!test && dropboxConfigured() && record.dropboxPath) {
    try {
      const name = `${amended.folderName}_Usage_Sheet_amended_${n}.xlsx`
      const sheet = await buildUsageWorkbook(amended, amended.items.filter(i => !i.excluded), { internal: true })
      await uploadFile(`${record.dropboxPath.replace(/\/+$/, '')}/${name}`, sheet)
      filed = name
    } catch (err) {
      filed = ''
      console.error('Amended sheet not filed:', err.message)
    }
  }

  const sentOn = String(record.createdAt || record.submittedAt || '').slice(0, 10)
  // A correction only makes sense to a distributor who had the usage. One
  // who never did (their rows were held back, or the item is new to them)
  // gets the usage itself, by Send on the case — not a "CORRECTION" of an
  // email they never received.
  const hadIt = new Set((record.emailsSent || []).filter(e => e && e.ok && !e.test && !e.testOnly).map(e => e.key))
  const results = []
  for (const change of changes) {
    const distributor = DISTRIBUTORS[change.key]
    if (!distributor) continue
    if (!test && !hadIt.has(change.key)) {
      results.push({
        key: change.key, name: distributor.name, ok: false, needsFirstSend: true, lines: change.lines,
        error: `Not sent: ${distributor.name} has not had this usage yet. Send it to them from the case — it will include this change.`
      })
      continue
    }
    const theirs = groups.get(change.key) || []
    const to = test ? [session.email] : distributor.to
    try {
      const xlsx = theirs.length ? await buildUsageWorkbook(amended, theirs) : null
      await sendUsageEmail({
        to, cc: test ? [] : ccFor(session.email),
        subject: amended.folderName, caseId: record.id,
        distributorLabel: distributor.name,
        xlsx, xlsxFilename: `${amended.folderName}_Usage_Sheet_corrected.xlsx`,
        test: test ? { wouldSendTo: distributor.to } : undefined,
        correction: { sentOn, lines: change.lines },
        sender: { name: session.name, email: session.email }
      })
      results.push({ key: change.key, name: distributor.name, ok: true, test, lines: change.lines, sentAt: now })
    } catch (err) {
      results.push({ key: change.key, name: distributor.name, ok: false, test, error: err.message })
    }
  }

  let saved = record
  if (!test) {
    // Onto the record as it is now: a send that finished while this amend
    // was going out is kept, not overwritten.
    const fresh = (await getUsageRecord(record.id)) || record
    saved = {
      ...amended,
      emailsSent: fresh.emailsSent || [],
      filesSaved: filed ? [...(fresh.filesSaved || []), filed] : fresh.filesSaved,
      amendments: [...(fresh.amendments || []), { at: now, by: session.name, changes, results }],
      updatedAt: now
    }
    await saveUsageRecord(saved)
  }
  const failed = results.filter(r => !r.ok)
  return res.status(failed.length && failed.length === results.length ? 502 : 200)
    .json({ changes, results, test, filed, record: saved })
}

// ─── files / open: browsing what was filed ─────────────────
// Read-only browsing of the Dropbox tree, so a saved usage sheet and the shared
// resources folder are both reachable from the phone. Paths are constrained to
// the two known roots — an unconstrained path parameter would let any signed-in
// staff member read the whole Dropbox account.

function assertAllowedPath(path) {
  const roots = [usageRoot().toLowerCase(), resourcesRoot().toLowerCase()]
  const lower = String(path || '').toLowerCase()
  if (!roots.some(root => lower === root || lower.startsWith(root + '/'))) {
    throw badRequest('That folder is outside the usage and resources folders')
  }
  if (lower.includes('..')) throw badRequest('Invalid path')
}

// ─── Filed usage, from the portal's own record ───────────────────────────────
// "In the filed usage page, we need to be able to tap those filed usages and
// see them from the portal view via the dropbox link. The file layout in the
// portal should mimic how it looks in dropbox." — Brent, 4 Nov 2026, who chose
// to show only what the portal files itself: the older usage folders are still
// unredacted, and stay unread until he says otherwise.
//
// So the tree is not read from Dropbox at all. It is built from the usage
// records the portal kept when it filed each case — the case's Dropbox folder
// and the files it saved there — laid out exactly as the folders are:
// Surgeon / Month Year / Case / files. A file opens only if it is one of those.

const lowerPath = p => String(p || '').replace(/\/+$/, '').toLowerCase()

async function portalFiled() {
  const records = await getUsageHistory(500)
  return records
    .filter(r => r.dropboxPath && (r.filesSaved || []).length)
    .map(r => ({ path: r.dropboxPath.replace(/\/+$/, ''), files: r.filesSaved, at: r.createdAt }))
}

/** The entries directly under `path`, from what the portal filed. */
export function filedEntries(filed, path) {
  const here = lowerPath(path)
  const folders = new Map()
  const files = []
  for (const c of filed) {
    const casePath = lowerPath(c.path)
    if (casePath === here) {
      for (const name of c.files) files.push({ kind: 'file', name, path: `${c.path}/${name}`, modified: c.at })
      continue
    }
    if (!casePath.startsWith(here + '/')) continue
    const next = c.path.slice(here.length + 1).split('/')[0]
    const key = next.toLowerCase()
    const entry = folders.get(key) || { kind: 'folder', name: next, path: `${c.path.slice(0, here.length)}/${next}`, modified: c.at }
    if (String(c.at) > String(entry.modified)) entry.modified = c.at
    folders.set(key, entry)
  }
  return [
    ...[...folders.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ...files.sort((a, b) => a.name.localeCompare(b.name))
  ]
}

/** Whether a file path is one the portal itself filed. */
export function isPortalFiled(filed, path) {
  const target = lowerPath(path)
  return filed.some(c => c.files.some(name => lowerPath(`${c.path}/${name}`) === target))
}

async function handleFiles(req, res) {
  if (!dropboxConfigured()) {
    return res.status(200).json({ configured: false, entries: [] })
  }
  const root = req.query.root === 'resources' ? resourcesRoot() : usageRoot()
  const path = req.query.path || root
  assertAllowedPath(path)

  if (root === usageRoot()) {
    const entries = filedEntries(await portalFiled(), path)
    return res.status(200).json({ configured: true, path, root, missing: false, portalFiledOnly: true, entries })
  }

  const { entries, missing } = await listFolder(path)
  return res.status(200).json({
    configured: true, path, root, missing,
    // Never send the account-absolute path any further than needed.
    entries: entries.map(e => ({ ...e, displayPath: undefined }))
  })
}

/**
 * Everything filed under a surname, as cases rather than folders.
 *
 * The tree is filed by surgeon and then by month, so a patient who saw Thani
 * in 2024 and Garg in 2026 sits in two places years apart. This is the
 * question the admin team actually asks, and the tree cannot answer it.
 */
async function handleHistory(req, res) {
  if (!dropboxConfigured()) {
    return res.status(200).json({ configured: false, cases: [] })
  }
  const surname = String(req.query.surname || '').trim()
  // Two characters, or a single letter returns a sizeable share of the
  // practice and nobody meant to ask for that.
  if (surname.length < 2) throw badRequest('Give at least two letters of a surname')

  const { cases } = await patientHistory(surname)
  const reviews = await getUsageReviews(cases.map(c => c.path))
  return res.status(200).json({
    configured: true,
    cases: cases.map(c => ({
      ...c,
      reviewed: reviews[c.path] || null,
      files: c.files.map(file => ({ ...file, displayPath: undefined }))
    }))
  })
}

/** Ticks a filed case off as checked, or clears the tick. */
async function handleReviewed(req, res, session) {
  if (req.method !== 'POST') throw badRequest('POST required')
  const { path, reviewed } = req.body || {}
  if (!path) throw badRequest('path is required')
  assertAllowedPath(path)

  // Whoever is signed in, not whoever the client says — the whole value of
  // the tick is that it names a person who can be asked about it.
  const entry = await setUsageReviewed(path, reviewed === false ? null : session.email)
  return res.status(200).json({ ok: true, reviewed: entry })
}

async function handleOpen(req, res) {
  if (!dropboxConfigured()) throw badRequest('Dropbox is not connected')
  const path = req.query.path
  if (!path) throw badRequest('path is required')
  assertAllowedPath(path)

  const usage = lowerPath(path).startsWith(lowerPath(usageRoot()) + '/')
  if (usage && !isPortalFiled(await portalFiled(), path)) {
    throw badRequest('Only usage filed by the portal can be opened here for now')
  }
  const link = await temporaryLink(path, { portalFiled: usage })
  // Short-lived by design: the link is fetched per tap and never persisted.
  return res.status(200).json({ url: link.url, name: link.name, expiresInHours: 4 })
}

// ─── list: history ─────────────────────────────────────────

async function handleList(req, res) {
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 100)
  const history = await getUsageHistory(limit)
  return res.status(200).json({
    records: history.map(r => ({
      id: r.id,
      folderName: r.folderName,
      date: r.date,
      hospital: r.hospital,
      patientSurname: r.patientSurname,
      surgeonSurname: r.surgeonSurname,
      procedure: r.procedure,
      repName: r.repName,
      itemCount: (r.items || []).filter(i => !i.excluded).length,
      dropboxPath: r.dropboxPath,
      filesSaved: r.filesSaved || [],
      emailsSent: r.emailsSent || [],
      amendments: (r.amendments || []).length,
      createdByEmail: r.createdByEmail || '',
      createdAt: r.createdAt
    }))
  })
}

// ─── Resupply (see api/_resupply.js) ───────────────────────

// How far back a resupply looks for its case. Distributors resupply within
// days, occasionally weeks for a back-order.
const RESUPPLY_LOOKBACK = 150

/** A case as the resupply screens show it: what is needed to recognise it. */
function caseSummary(record) {
  return {
    id: record.id,
    folderName: record.folderName,
    patientSurname: record.patientSurname,
    surgeonSurname: record.surgeonSurname,
    hospital: record.hospital,
    date: record.date,
    filed: Boolean(record.dropboxPath)
  }
}

async function comparisonFor(usageId, resupply) {
  const record = await getUsageRecord(usageId)
  if (!record) return null
  const earlier = (await getCaseResupplies(usageId))
    .filter(e => !resupply.distributorKey || e.distributorKey === resupply.distributorKey)
  return { record, earlier, comparison: compareResupply(record, resupply.distributorKey, resupply.lines, earlier) }
}

async function handleResupplyRead(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.ANTHROPIC_API_KEY) throw badRequest('Scanning is not switched on yet (ANTHROPIC_API_KEY is missing).')
  const pages = validatePages(req.body?.pages)

  const message = await streamClaude({
    feature: 'resupply-scan',
    whenUnavailable: 'The resupply could not be read right now — try again shortly.',
    request: {
      model: VISION_MODEL,
      max_tokens: 8000,
      output_config: { effort: 'high' },
      messages: [{ role: 'user', content: [...contentBlocksFor(pages), { type: 'text', text: RESUPPLY_PROMPT }] }]
    }
  })
  if (message.stop_reason === 'refusal') throw new Error('The document could not be processed. Please contact Brenton.')
  const textBlock = message.content.find(b => b.type === 'text')
  if (!textBlock) throw new Error('No data was returned from the document')

  const resupply = normaliseResupply(parseExtraction(textBlock.text))
  const records = await getUsageHistory(RESUPPLY_LOOKBACK)
  const candidates = candidateCases(resupply, records)
  const best = candidates[0]
  // Matched outright only when the document named the case — by reference or
  // surname — and nothing else comes close. Otherwise the person picks.
  const sure = best && (best.why.includes('reference') || best.why.includes('surname'))
    && (!candidates[1] || best.score - candidates[1].score >= 4)
  const matched = sure ? await comparisonFor(best.record.id, resupply) : null

  return res.status(200).json({
    resupply,
    candidates: candidates.map(c => ({ ...caseSummary(c.record), why: c.why })),
    matchedId: matched ? best.record.id : null,
    comparison: matched?.comparison || null,
    earlierCount: matched?.earlier.length || 0
  })
}

/** The comparison against a case the person chose (or a corrected document). */
async function handleResupplyCompare(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { usageId } = req.body || {}
  if (!usageId) throw badRequest('No usage case chosen')
  const resupply = normaliseResupply(req.body?.resupply || {})
  const found = await comparisonFor(usageId, { ...resupply, distributorKey: req.body?.resupply?.distributorKey || resupply.distributorKey })
  if (!found) return res.status(404).json({ error: 'That usage case could not be found' })
  return res.status(200).json({ comparison: found.comparison, earlierCount: found.earlier.length, case: caseSummary(found.record) })
}

async function handleResupplySave(req, res, session) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { id, usageId } = req.body || {}
  if (!/^[a-z0-9-]{8,64}$/i.test(String(id || ''))) throw badRequest('Missing resupply id')
  const given = req.body?.resupply || {}
  const resupply = { ...normaliseResupply(given), distributorKey: given.distributorKey || normaliseResupply(given).distributorKey }
  if (!resupply.lines.length) throw badRequest('There are no lines to record')

  // Saved once, whatever happens to the connection: a retry of the same scan
  // answers with what was saved the first time.
  if (!(await claimResupply(id))) {
    const existing = await getResupply(id)
    if (existing) return res.status(200).json({ entry: existing, alreadySaved: true })
    // Claimed but not saved: another tap still in progress.
    return res.status(409).json({ error: 'This resupply is already being saved — check Still owed in a moment.' })
  }
  try {
    return await saveClaimedResupply(req, res, session, { id, usageId, resupply })
  } catch (err) {
    // Nothing was recorded, so the same scan must be able to try again.
    await releaseResupply(id)
    throw err
  }
}

async function saveClaimedResupply(req, res, session, { id, usageId, resupply }) {

  let record = null
  let comparison = null
  let earlier = []
  if (usageId) {
    const found = await comparisonFor(usageId, resupply)
    if (!found) {
      await releaseResupply(id)
      return res.status(404).json({ error: 'That usage case could not be found' })
    }
    ;({ record, comparison, earlier } = found)
  }

  // Filed beside the usage, named the way the team names them. Dropbox first,
  // so a failed filing records nothing and can simply be retried.
  let filed = ''
  let fileError = ''
  if (record?.dropboxPath && dropboxConfigured() && Array.isArray(req.body?.pages) && req.body.pages.length) {
    try {
      const pdf = await buildScanPdf(validatePages(req.body.pages))
      const name = resupplyFileName({
        patientSurname: record.patientSurname,
        distributorKey: resupply.distributorKey,
        partial: comparison.totals.owing > 0 || earlier.length > 0,
        n: earlier.length + 1
      })
      // Kept, never overwritten: a second document of the same name (a
      // partial resupply scanned twice, or a count that missed one) is added
      // beside it as "… (1).pdf" rather than replacing the first.
      const up = await uploadFile(`${record.dropboxPath}/${name}`, pdf, { keep: true })
      filed = String(up?.path_display || up?.name || name).split('/').pop()
    } catch (err) {
      fileError = err.message
    }
  }

  const entry = {
    id,
    usageId: usageId || null,
    distributorKey: resupply.distributorKey,
    distributor: resupply.distributor,
    documentNumber: resupply.documentNumber,
    documentDate: resupply.documentDate,
    lines: resupply.lines.map(({ referenceCode, description, lotNumber, quantity, backordered }) =>
      ({ referenceCode, description, lotNumber, quantity, backordered })),
    owingAfter: comparison ? comparison.totals.owing : null,
    filed,
    scannedBy: session.name,
    scannedByEmail: session.email,
    at: new Date().toISOString()
  }
  await saveResupply(entry)
  return res.status(200).json({ entry, comparison, fileError, case: record ? caseSummary(record) : null })
}

// Tracking starts the day it went live: every case before it would otherwise
// read as wholly owed, because nobody scanned its resupply.
const TRACK_FROM = process.env.RESUPPLY_TRACK_FROM || '2026-11-06'

/** Every recent case with something still owed, per distributor, oldest first. */
async function handleResupplyOwing(req, res) {
  const records = (await getUsageHistory(RESUPPLY_LOOKBACK))
    .filter(r => (r.date || '') >= TRACK_FROM || (r.createdAt || '').slice(0, 10) >= TRACK_FROM)
  const today = new Date().toISOString().slice(0, 10)
  const rows = []
  for (const record of records) {
    const sent = new Set((record.emailsSent || []).filter(e => e && !e.testOnly && (e.ok !== false)).map(e => e.key || e.distributorKey))
    const keys = [...new Set(itemsFor(record).map(i => i.distributorKey).filter(Boolean))]
    if (!keys.length) continue
    const resupplies = await getCaseResupplies(record.id)
    for (const key of keys) {
      const earlier = resupplies.filter(e => e.distributorKey === key
        || (key === 'device_boost' && e.distributorKey === 'device') || (key === 'device' && e.distributorKey === 'device_boost'))
      const { totals } = compareResupply(record, key, [], earlier)
      if (totals.owing <= 0) continue
      rows.push({
        ...caseSummary(record),
        distributorKey: key,
        distributor: DISTRIBUTORS[key]?.name || key,
        used: totals.used,
        resupplied: totals.before,
        owing: totals.owing,
        usageSent: sent.size ? sent.has(key) : null,
        days: record.date ? Math.round((Date.parse(today) - Date.parse(record.date)) / 86400000) : null
      })
    }
  }
  rows.sort((a, b) => (b.days || 0) - (a.days || 0))
  return res.status(200).json({ rows, trackingFrom: TRACK_FROM })
}

// ─── Removing a duplicate case (Brent, 6 Nov 2026) ─────────────────────────
// The Matthews double-up left a second case on record; without this it would
// sit in history and on Still owed asking for a second Boost resupply. An
// admin, or whoever scanned it, can take it off — kept, marked removed, never
// erased. Dropbox and the email log are left as they are.
async function handleRemoveDuplicate(req, res, session) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { usageId, reason } = req.body || {}
  if (!usageId) throw badRequest('No usage case chosen')
  const record = await getUsageRecord(usageId)
  if (!record) return res.status(404).json({ error: 'That usage case could not be found' })
  const admin = STAFF.some(s => s.email === session.email && s.isAdmin)
  if (!admin && record.createdByEmail !== session.email) {
    return res.status(403).json({ error: 'Only an admin, or whoever scanned it, can remove a case' })
  }
  const removed = await removeUsageRecord(usageId, {
    by: session.name, byEmail: session.email, at: new Date().toISOString(),
    reason: String(reason || 'duplicate').slice(0, 200)
  })
  return res.status(200).json({ removed: Boolean(removed) })
}
