import Anthropic from '@anthropic-ai/sdk'
import { requireSession } from '../_auth.js'
import { markAttendance } from '../_googleCalendar.js'
import { STAFF } from '../../src/staffConfig.js'
import { saveUsageRecord, getUsageRecord, getUsageHistory } from '../_redis.js'
import { normaliseCase, recomputeCase } from '../_usageCase.js'
import { DISTRIBUTORS, groupByDistributor, ccFor } from '../_distributors.js'
import { buildUsageWorkbook } from '../_usageExcel.js'
import { buildScanPdf } from '../_usagePdf.js'
import {
  caseFolderPath, saveUsageFiles, dropboxConfigured,
  listFolder, temporaryLink, resourcesRoot, usageRoot
} from '../_dropbox.js'
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

const EXTRACTION_PROMPT = `You are a surgical implant usage extraction specialist. Analyse this hospital usage document carefully. Extract every implant sticker and handwritten entry. For each item identify: distributor/manufacturer, product name, reference/catalogue code, lot number, size/dimensions, quantity used, rebate code if present. Also extract: patient surname, patient first name, patient UR number, surgeon name, date, hospital (CLV or RHH), procedure description, rep name. EXCLUDE: Floseal, Surgicel, Spongistan and other haemostatic/peripheral products that are not implants. Flag any handwritten items that cannot be clearly identified as MANUAL REVIEW REQUIRED. Return structured JSON.

The document is a "Record of Implantable/Rebatable Items Used" form from Calvary Health Care Tasmania (CLV) or Royal Hobart Hospital (RHH). It mixes printed implant stickers with handwritten quantities ("x1", "x3", "×4"), handwritten product names, a printed patient ID label, and a handwritten date, procedure and rep name.

Accuracy matters more than completeness of detail. Never invent a value: if a field is not legible, return an empty string for it. If you are not confident you have read an item correctly, set "confidence" to "low" and "manualReview" to true rather than guessing — a human will check every flagged row.

Return ONLY a JSON object (no markdown fences, no preamble, no trailing commentary) of exactly this shape:
{
  "patientSurname": "",
  "patientFirstName": "",
  "patientUrNumber": "",
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

/**
 * The name this person is known by, from the roster.
 *
 * Taken from staffConfig rather than split off the full name: Brenton is Brent and
 * Matthew is Mat, and the calendar has to match what the team already writes there
 * by hand.
 */
function firstNameFor(email) {
  const staff = STAFF.find(s => s.email.toLowerCase() === String(email || '').toLowerCase())
  return staff?.firstName || ''
}

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
  const client = new Anthropic()

  // Streaming so a long extraction cannot trip the HTTP request timeout.
  const stream = client.messages.stream({
    model: VISION_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'high' },
    messages: [{
      role: 'user',
      content: [...contentBlocksFor(pages), { type: 'text', text: EXTRACTION_PROMPT }]
    }]
  })
  const message = await stream.finalMessage()

  if (message.stop_reason === 'refusal') {
    throw new Error('The document could not be processed. Please contact Brenton.')
  }

  const textBlock = message.content.find(b => b.type === 'text')
  if (!textBlock) throw new Error('No data was returned from the document')

  const extracted = parseExtraction(textBlock.text)
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
    truncated: message.stop_reason === 'max_tokens'
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
    emailsSent: incoming.emailsSent || [],
    createdByEmail: session.email,
    createdAt: incoming.createdAt || new Date().toISOString(),
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

  const { usageId, only, testOnly, pages } = req.body || {}
  if (!usageId) throw badRequest('No usage record specified')

  const record = await getUsageRecord(usageId)
  if (!record) return res.status(404).json({ error: 'Usage record not found' })
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

  for (const key of targets) {
    const distributor = DISTRIBUTORS[key]
    const items = groups.get(key)
    const to = test ? [session.email] : distributor.to
    try {
      const xlsx = await buildUsageWorkbook(record, items)
      const sent = await sendUsageEmail({
        to,
        cc,
        subject: record.folderName,
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
        senderFellBack: Boolean(sent?.senderFellBack),
        scanAttached: Boolean(scanPdf),
        sentAt: new Date().toISOString()
      })
    } catch (err) {
      results.push({ key, name: distributor.name, to, itemCount: items.length, ok: false, test, error: err.message })
    }
  }

  // A test is not recorded against the case. Otherwise it would show as sent, and
  // the distributor would never get the real one — a test that quietly satisfies
  // the thing it was testing is worse than no test.
  const updated = test
    ? record
    : (() => {
      // Keep the latest outcome per distributor so a retry replaces the failure.
      const merged = [...(record.emailsSent || [])].filter(e => !results.some(r => r.key === e.key))
      return { ...record, emailsSent: [...merged, ...results], updatedAt: new Date().toISOString() }
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

async function handleFiles(req, res) {
  if (!dropboxConfigured()) {
    return res.status(200).json({ configured: false, entries: [] })
  }
  const root = req.query.root === 'resources' ? resourcesRoot() : usageRoot()
  const path = req.query.path || root
  assertAllowedPath(path)

  const { entries, missing } = await listFolder(path)
  return res.status(200).json({
    configured: true, path, root, missing,
    // Never send the account-absolute path any further than needed.
    entries: entries.map(e => ({ ...e, displayPath: undefined }))
  })
}

async function handleOpen(req, res) {
  if (!dropboxConfigured()) throw badRequest('Dropbox is not connected')
  const path = req.query.path
  if (!path) throw badRequest('path is required')
  assertAllowedPath(path)

  const link = await temporaryLink(path)
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
      createdAt: r.createdAt
    }))
  })
}
