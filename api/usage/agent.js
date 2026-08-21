import Anthropic from '@anthropic-ai/sdk'
import { requireSession } from '../_auth.js'
import { saveUsageRecord, getUsageRecord, getUsageHistory } from '../_redis.js'
import { normaliseCase, recomputeCase } from '../_usageCase.js'
import { DISTRIBUTORS, groupByDistributor, ccFor } from '../_distributors.js'
import { buildUsageWorkbook } from '../_usageExcel.js'
import { buildScanPdf } from '../_usagePdf.js'
import { caseFolderPath, saveUsageFiles } from '../_dropbox.js'
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

async function handleScan(req, res, session) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured')

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
    buildUsageWorkbook(caseRecord, included)
  ])

  // Dropbox first. If this throws the record is not written and no email goes
  // out, so the rep can simply retry.
  const { saved } = await saveUsageFiles({
    folderPath,
    folderName: caseRecord.folderName,
    scanPdf,
    usageSheet
  })

  const record = {
    ...caseRecord,
    id: incoming.id || `${Date.now()}-${(caseRecord.patientSurname || 'case').toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    dropboxPath: folderPath,
    filesSaved: saved,
    emailsSent: incoming.emailsSent || [],
    createdByEmail: session.email,
    createdAt: incoming.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  await saveUsageRecord(record)

  const groups = groupByDistributor(record.items)
  const heldBack = record.items.filter(i => !i.excluded && (i.manualReview || !i.distributorKey))

  return res.status(200).json({
    record,
    dropboxPath: folderPath,
    filesSaved: saved,
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

  const { usageId, only } = req.body || {}
  if (!usageId) throw badRequest('No usage record specified')

  const record = await getUsageRecord(usageId)
  if (!record) return res.status(404).json({ error: 'Usage record not found' })
  if (!record.dropboxPath) {
    return res.status(409).json({ error: 'Save to Dropbox before sending usage emails' })
  }

  const groups = groupByDistributor(record.items)
  if (groups.size === 0) {
    return res.status(400).json({ error: 'No items are ready to send — resolve the flagged rows first' })
  }

  // `only` lets the rep retry a single distributor that failed earlier.
  const targets = only?.length ? [...groups.keys()].filter(k => only.includes(k)) : [...groups.keys()]
  const cc = ccFor(session.email)
  const results = []

  for (const key of targets) {
    const distributor = DISTRIBUTORS[key]
    const items = groups.get(key)
    try {
      const xlsx = await buildUsageWorkbook(record, items)
      await sendUsageEmail({
        to: distributor.to,
        cc,
        subject: record.folderName,
        distributorLabel: distributor.name,
        xlsx,
        xlsxFilename: `${record.folderName}_Usage_Sheet.xlsx`
      })
      results.push({ key, name: distributor.name, to: distributor.to, itemCount: items.length, ok: true, sentAt: new Date().toISOString() })
    } catch (err) {
      results.push({ key, name: distributor.name, to: distributor.to, itemCount: items.length, ok: false, error: err.message })
    }
  }

  // Keep the latest outcome per distributor so a retry replaces the failure.
  const merged = [...(record.emailsSent || [])].filter(e => !results.some(r => r.key === e.key))
  const updated = { ...record, emailsSent: [...merged, ...results], updatedAt: new Date().toISOString() }
  await saveUsageRecord(updated)

  const failed = results.filter(r => !r.ok)
  return res.status(failed.length && failed.length === results.length ? 502 : 200).json({
    results,
    allSent: failed.length === 0,
    record: updated
  })
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
