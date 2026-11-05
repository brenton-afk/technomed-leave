import ExcelJS from 'exceljs'
import { redis, redisSetBody } from './_redis.js'
import { listFolder, downloadFile, dropboxConfigured } from './_dropbox.js'

// ─── Toni's distributor price list (Brent, 5 Nov 2026) ───────────────────────
// "If you've taken prices from Signus from 6/10/26 they'll be accurate."
// Self-funding quotes take their LINES from the Xero templates and their
// PRICES from this list: the newest "TechnoMed_Distributor_Price_Lists…xlsx"
// in Admin/Accounts, one tab per distributor, columns Product range, Product
// type, Description, Product code, Rebate (PL) code, Price (AUD). Read from
// Dropbox at most every 12 hours; prices as Toni typed them (ex GST).

const FOLDER = process.env.PRICE_LIST_FOLDER || '/Admin/Accounts'
const NAME = /distributor[_\s-]*price[_\s-]*list/i
const CACHE = 'pricelist:cache'
const TTL = 12 * 3600

const text = v => {
  if (v == null) return ''
  if (typeof v === 'object') return String(v.text ?? v.result ?? (v.richText ? v.richText.map(r => r.text).join('') : ''))
  return String(v)
}
const money = v => {
  const s = text(v).replace(/[$,\s]/g, '')
  const n = s === '' ? NaN : Number(s)
  return Number.isFinite(n) && n > 0 ? n : NaN // a blank or $0 price is never used
}

/** Rows from the workbook: [{ range, description, code, rebate, price }]. */
export async function readPriceWorkbook(buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const rows = []
  wb.eachSheet(ws => {
    let cols = null
    ws.eachRow(row => {
      const cells = row.values.map(text)
      if (!cols) {
        const at = name => cells.findIndex(c => c && c.toLowerCase().startsWith(name))
        const code = at('product code'), price = at('price')
        if (code > 0 && price > 0) cols = { code, price, desc: at('description'), range: at('product range'), rebate: at('rebate') }
        return
      }
      const code = cells[cols.code]?.trim()
      const price = money(row.values[cols.price])
      if (!code || !Number.isFinite(price)) return
      rows.push({ sheet: ws.name, range: cells[cols.range] || '', description: cells[cols.desc] || '', code, rebate: cells[cols.rebate] || '', price })
    })
  })
  return rows
}

/** The newest price list file in the folder. */
async function newestList() {
  const { entries } = await listFolder(FOLDER)
  return entries.filter(e => e.kind === 'file' && NAME.test(e.name) && /\.xlsx$/i.test(e.name))
    .sort((a, b) => String(b.modified).localeCompare(String(a.modified)))[0] || null
}

/** { file, modified, rows } — from the 12-hour cache, else Dropbox. Null if there is none. */
export async function priceList({ fresh = false } = {}) {
  if (!fresh) {
    const cached = await redis('GET', CACHE).catch(() => null)
    if (cached) { try { return JSON.parse(cached) } catch { /* reload */ } }
  }
  if (!dropboxConfigured()) return null
  const file = await newestList()
  if (!file) return null
  const rows = await readPriceWorkbook(await downloadFile(file.path))
  const list = { file: file.name, modified: file.modified, rows }
  await redisSetBody(CACHE, JSON.stringify(list)).catch(() => {})
  await redis('EXPIRE', CACHE, String(TTL)).catch(() => {})
  return list
}

const norm = c => String(c || '').toUpperCase().replace(/\s+/g, ' ').trim()

/**
 * The list price for a template line's code. An exact code wins; a template
 * code written with x's for sizes ("AB0321-xxxxx", "MACNITxxxxx R/R") matches
 * every code of that shape, and is priced only when they all cost the same —
 * otherwise it is ambiguous and the caller keeps the template price and says so.
 */
export function listPrice(code, rows = []) {
  const want = norm(code)
  if (!want) return { found: false }
  const exact = rows.find(r => norm(r.code) === want)
  if (exact) return { found: true, price: exact.price, code: exact.code }
  if (!/X{2,}/.test(want)) return { found: false }
  const pattern = new RegExp(`^${want.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/X{2,}/g, m => `[A-Z0-9]{${m.length}}`)}$`)
  const hits = rows.filter(r => pattern.test(norm(r.code)))
  if (!hits.length) return { found: false }
  const prices = [...new Set(hits.map(r => r.price))]
  if (prices.length > 1) return { found: false, ambiguous: true, prices }
  return { found: true, price: prices[0], code: `${hits.length} codes` }
}
