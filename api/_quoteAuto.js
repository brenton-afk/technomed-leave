import { redis, redisSetBody } from './_redis.js'
import { askClaude } from './_anthropic.js'
import { listQuoteRequests } from './_quoteRequests.js'
import { quoteTemplates, quotesFor, findContacts, createDraftQuote, getQuote, quotePdf } from './_xeroAccounting.js'
import { DISTRIBUTORS, detectDistributor, distributorsForKit } from './_distributors.js'
import { ensureFolder, uploadFile, dropboxConfigured } from './_dropbox.js'
import { sendBookingNotice, escapeHtml } from './_email.js'
import { priceList, listPrice } from './_priceList.js'
import { todayStr, addCivilDays, parseDateStr, toDateStr } from '../src/clinicalPlan/week.js'

// ─── Self-funding quotes, drafted and followed up by themselves ──────────────
// Brent, 5 Nov 2026: "Use the templates to inform. 20% is blanket for all
// distributors, and I want you to automate an email once we send the quote
// that goes to the respective distributor with the quote attached to give
// them a heads up. Yes portal should save it in the same way."
//
//  1. A CNS request (bookings@ or brenton@, _quoteRequests.js) is matched to
//     one of the quote templates kept in Xero, and a DRAFT quote is made for
//     Centre for Neurosurgery from that template's lines and prices — never a
//     line or price the templates do not have. No good match: held, with why.
//  2. Once someone has sent it from Xero (status SENT or later), the PDF is
//     filed in the surgeon's self-funding folder, named as the team names them,
//     and each distributor with products on it gets a heads-up with the quote
//     attached, from Brent, bookings@ copied. Each step once, recorded.
// The patient's surname appears in the subject and body, as on booking notices;
// the full details travel only in the attached quote.

const MODEL = process.env.QUOTE_MODEL || process.env.PO_VISION_MODEL || 'claude-opus-5'
const CUSTOMER = process.env.QUOTE_CUSTOMER || 'Centre for Neurosurgery'
const SENDER = { name: 'Brenton Lovering', email: process.env.QUOTE_SENDER || 'brenton@technomed.com.au' }
export const DISCOUNT = 20
const KEY = id => `quote:req:${id}`
const LOG = 'quote:req:log'
const LOCK = 'quote:auto:lock'
const SENT = new Set(['SENT', 'ACCEPTED', 'INVOICED'])

// Where the team already files them (seen in Dropbox, 5 Nov 2026); anyone else
// gets the same shape under their own surgeon folder.
const FOLDERS = {
  thani: '/ALL SURGEON USAGE/SPINE Usage/THANI - SPINE/Thani Self Funding Quotes',
  ibbett: '/ALL SURGEON USAGE/SPINE Usage/IBBETT - SPINE/Self Funding Quotes',
  gupta: '/ALL SURGEON USAGE/SPINE Usage/GUPTA - SPINE/Gupta Self Funding Quotes',
  hannan: '/ALL SURGEON USAGE/SPINE Usage/HANNAN - SPINE/Self Funding Quotes - Hannan'
}
const clean = s => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()

export function quoteFolder(surgeon) {
  const surname = clean(String(surgeon || '').replace(/^dr\.?\s+/i, '').split(' ').pop())
  if (!surname) return '/ALL SURGEON USAGE/SPINE Usage/Self-funding Quotes - Surgeon Unknown'
  const known = FOLDERS[surname.toLowerCase()]
  if (known) return known
  const title = surname[0].toUpperCase() + surname.slice(1).toLowerCase()
  return `/ALL SURGEON USAGE/SPINE Usage/${surname.toUpperCase()} - SPINE/${title} Self Funding Quotes`
}

export function quoteFileName(patient, number) {
  return `${clean(patient) || 'Patient'} Self Funding Quote ${String(number || '').replace(/-/g, '')}.pdf`.replace(/\s+\./, '.')
}

/** Every distributor with a product on the quote, from what each line says. */
export function distributorsOnQuote(lines = []) {
  const keys = new Set()
  for (const l of lines) {
    const text = `${l.description || ''} ${l.code || ''}`
    const k = detectDistributor(text) || distributorsForKit(text)[0]
    if (k && DISTRIBUTORS[k]) keys.add(k)
  }
  return [...keys]
}

/**
 * The model's choice, checked against the templates. Lines and prices come
 * only from the chosen template: a quantity may change (levels), a line may
 * be dropped, nothing may be invented or repriced. 20% off every line that
 * carries a distributor's product unless the template says otherwise.
 *
 * Prices (Brent, 5 Nov 2026, "option 2"): from Toni's distributor price list
 * when the line's code is on it; otherwise the template's price, and the
 * line is flagged so a person checks it before the quote is sent.
 */
export function checkPlan(plan, templates, { prices = null } = {}) {
  const hold = reason => ({ ok: false, reason })
  if (!plan || plan.hold) return hold(plan?.hold || 'No reading of the request')
  const tpl = templates.find(t => t.id === plan.templateId)
  if (!tpl) return hold('No quote template matches this request')
  const byKey = new Map(tpl.lines.map(l => [`${l.code}|${l.description}`.toLowerCase(), l]))
  const byCode = new Map(tpl.lines.filter(l => l.code).map(l => [l.code.toLowerCase(), l]))
  const lines = []
  const flags = []
  for (const l of plan.lines || []) {
    const from = byKey.get(`${l.code || ''}|${l.description || ''}`.toLowerCase()) || (l.code && byCode.get(String(l.code).toLowerCase()))
    if (!from) return hold(`A line not in the "${tpl.title || tpl.number}" template was proposed: ${l.description || l.code}`)
    const quantity = Number(l.quantity)
    if (!(quantity > 0)) continue
    const discount = from.discount || (distributorsOnQuote([from]).length ? DISCOUNT : 0)
    let unitPrice = Number(from.unitPrice)
    if (prices) {
      const lp = listPrice(from.code, prices)
      if (lp.found) unitPrice = lp.price
      else flags.push({ code: from.code || '', description: from.description || '', price: unitPrice,
        reason: lp.ambiguous ? 'several prices on the price list for this code — template price used' : 'not on the price list — template price used' })
    }
    lines.push({ code: from.code, description: from.description, quantity, unitPrice, discount })
  }
  if (!lines.length) return hold('No lines left after matching the template')
  return { ok: true, template: tpl, lines, flags }
}

const PROMPT = `You prepare self-funding (uninsured) implant quotes for TechnoMed, a surgical implant distributor in Tasmania.
Below is a quote request from a neurosurgery practice (CNS), then TechnoMed's quote TEMPLATES (id, title, summary, lines).
Choose the ONE template that best fits the operation, surgeon and number of levels. Copy its lines exactly (code and description unchanged).
You may change a quantity only where the levels differ from the template (e.g. two-level fixation needs more screws than one-level), and you may drop a line the operation clearly does not need. Never add a line that is not in the chosen template.
Reply with JSON only:
{"templateId":"", "surgeon":"", "patient":"", "procedure":"", "levels":"", "system":"", "lines":[{"code":"","description":"","quantity":0}], "why":"", "hold":""}
- patient: the patient's name exactly as written in the request ("" if none).
- surgeon: as written or as the template implies ("" if neither says).
- hold: a short reason if no template fits well enough to quote safely; otherwise "".`

async function plan(request, templates) {
  const list = templates.map(t => ({ id: t.id, title: t.title, summary: t.summary, lines: t.lines.map(l => ({ code: l.code, description: l.description, quantity: l.quantity })) }))
  const reply = await askClaude({
    feature: 'self-funding-quote',
    whenUnavailable: 'The quote request could not be read automatically — make the quote by hand.',
    timeoutMs: 40000,
    request: {
      model: MODEL, max_tokens: 3000, thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: `REQUEST\nFrom: ${request.from}\nSubject: ${request.subject}\n\n${request.text}\n\nTEMPLATES\n${JSON.stringify(list).slice(0, 60000)}\n\n${PROMPT}` }]
    }
  })
  const text = reply.content.filter(b => b.type === 'text').map(b => b.text).join('')
  try { return JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] || '{}') } catch { return {} }
}

export function quoteSummary(p) {
  return [`Surgeon: ${p.surgeon || 'TBC'}`, `Patient: ${p.patient || 'TBC'}`, 'Date: TBC',
    `Procedure: ${p.procedure || 'TBC'}${p.levels ? ` (${p.levels})` : ''}`, `Kit/System: ${p.system || 'TBC'}`].join('\n')
}

async function save(id, entry) {
  await redisSetBody(KEY(id), JSON.stringify({ ...entry, at: new Date().toISOString() }))
  await redis('LPUSH', LOG, id).catch(() => {})
  await redis('LTRIM', LOG, '0', '199').catch(() => {})
}

export async function quoteRecords(ids = []) {
  if (!ids.length) return {}
  const got = await redis('MGET', ...ids.map(KEY)).catch(() => [])
  const out = {}
  ids.forEach((id, i) => { try { if (got?.[i]) out[id] = JSON.parse(got[i]) } catch { /* none */ } })
  return out
}

export async function forgetQuoteRequest(id) { await redis('DEL', KEY(id)) }

/**
 * A quote already in Xero for this patient — made by hand, or before the
 * portal did this. The patient's surname in its title, summary or reference
 * is enough: a duplicate draft is worse than a request left to a person.
 */
export function alreadyQuoted(patient, quotes = []) {
  const surname = String(patient || '').trim().split(/\s+/).pop()
  if (!surname || surname.length < 3) return null
  const re = new RegExp(`\\b${surname.replace(/[^A-Za-z'-]/g, '')}\\b`, 'i')
  return quotes.find(q => q.status !== 'DELETED' && re.test(`${q.title} ${q.summary} ${q.reference}`)) || null
}

/** Step 2 for one drafted quote: once sent, file it and tell the distributors. */
async function followUp(id, rec) {
  const q = await getQuote(rec.quoteId)
  if (!q) return { ...rec, status: 'gone', reason: 'The quote is no longer in Xero' }
  if (!SENT.has(q.status)) return rec
  let next = { ...rec, quoteNumber: q.number, sentSeen: rec.sentSeen || new Date().toISOString() }
  const pdf = await quotePdf(q.id)
  if (!next.filed && dropboxConfigured()) {
    const folder = quoteFolder(rec.surgeon)
    await ensureFolder(folder)
    await uploadFile(`${folder}/${quoteFileName(rec.patient, q.number)}`, Buffer.from(pdf, 'base64'))
    next.filed = true
  }
  const keys = distributorsOnQuote(q.lines)
  const done = new Set(next.notified || [])
  for (const key of keys) {
    if (done.has(key)) continue
    const d = DISTRIBUTORS[key]
    const surname = String(rec.patient || '').trim().split(/\s+/).pop() || 'patient'
    const lines = [`Hi ${d.name} team,`, '',
      'Just a heads up — we have sent CNS the attached quote for a self-funding patient.', '',
      `Surgeon: ${rec.surgeon || 'TBC'}`, `Patient: ${surname}`, `Procedure: ${rec.procedure || 'TBC'}`, 'Date: to be confirmed', '',
      'Our standing 20% self-funding discount has been applied to your products. We will mark the usage SELF FUNDING and attach the quote when the case goes ahead.']
    await sendBookingNotice({
      to: d.to, subject: `Self-funding quote sent — ${surname}${rec.surgeon ? ` · ${rec.surgeon}` : ''}`,
      text: lines.join('\n'), html: lines.map(l => (l ? `<p style="margin:0 0 6px">${escapeHtml(l)}</p>` : '')).join(''),
      sender: SENDER, caseId: `quote:${q.number}`,
      attachments: [{ filename: quoteFileName(rec.patient, q.number), content: pdf, content_type: 'application/pdf' }]
    })
    done.add(key)
  }
  next.notified = [...done]
  next.status = 'sent'
  return next
}

/** One pass: draft new requests, follow up sent ones. Locked; each step once. */
export async function autoQuotes({ max = 2, by = 'automatic' } = {}) {
  if (await redis('SET', LOCK, by, 'NX', 'EX', '90') !== 'OK') return { skipped: 'already running' }
  try {
    const { requests } = await listQuoteRequests()
    const records = await quoteRecords(requests.map(r => r.id))
    const drafted = []; const held = []; const followed = []; const failed = []

    // 2 — follow up anything drafted and not yet fully done.
    for (const r of requests) {
      const rec = records[r.id]
      if (!rec || !['drafted', 'sent'].includes(rec.status) || rec.complete) continue
      try {
        const next = await followUp(r.id, rec)
        if (next !== rec) {
          next.complete = next.status === 'sent' && (next.filed || !dropboxConfigured())
          await save(r.id, next)
          if (next.status === 'sent' && rec.status !== 'sent') followed.push({ quote: next.quoteNumber, notified: next.notified })
        }
      } catch (err) { failed.push({ request: r.id, error: err.message }) }
    }

    // 1 — draft new requests.
    const todo = requests.filter(r => !records[r.id]).slice(0, max)
    if (todo.length) {
      const templates = await quoteTemplates()
      const contact = (await findContacts(CUSTOMER)).find(c => c.name.toLowerCase() === CUSTOMER.toLowerCase())
      const existing = await quotesFor(CUSTOMER).catch(() => [])
      const list = await priceList().catch(err => { console.log('price list unavailable', err.message); return null })
      for (const r of todo) {
        try {
          if (!templates.length) { held.push({ request: r.id, reason: 'No quote templates found in Xero' }); await save(r.id, { status: 'held', reason: 'No quote templates found in Xero' }); continue }
          if (!contact) { held.push({ request: r.id, reason: `No Xero contact named ${CUSTOMER}` }); await save(r.id, { status: 'held', reason: `No Xero contact named ${CUSTOMER}` }); continue }
          const p = await plan(r, templates)
          const before = alreadyQuoted(p.patient, existing)
          if (before) { await save(r.id, { status: 'already', reason: `Already quoted in Xero: ${before.number}`, quoteNumber: before.number }); continue }
          const checked = checkPlan(p, templates, { prices: list?.rows || null })
          if (!checked.ok) { held.push({ request: r.id, reason: checked.reason }); await save(r.id, { status: 'held', reason: checked.reason, why: p.why || '' }); continue }
          const today = todayStr()
          const made = await createDraftQuote({
            contactId: contact.id, title: checked.template.title || 'Self-funding quote',
            reference: [p.procedure, p.levels].filter(Boolean).join(' ').slice(0, 250) || r.subject,
            summary: quoteSummary(p), date: today, expiryDate: toDateStr(addCivilDays(parseDateStr(today), 30)),
            lines: checked.lines
          })
          drafted.push({ request: r.id, quote: made.number, total: made.total })
          await save(r.id, { status: 'drafted', quoteId: made.id, quoteNumber: made.number, template: checked.template.title,
            patient: p.patient || '', surgeon: p.surgeon || '', procedure: [p.procedure, p.levels].filter(Boolean).join(' '), notified: [],
            priceList: list?.file || '', flags: list ? checked.flags : [{ reason: 'Price list could not be read — every price is from the template' }] })
        } catch (err) {
          if (err.code === 'permission') throw err
          failed.push({ request: r.id, error: err.message })
        }
      }
    }
    console.log('quote auto', JSON.stringify({ drafted: drafted.length, held: held.length, followed: followed.length, failed: failed.length }))
    return { drafted, held, followed, failed }
  } finally {
    await redis('DEL', LOCK).catch(() => {})
  }
}
