// ─── The distributor price lists, kept in the portal (Brent, 18 Nov 2026) ────
// "This is important information to add to the portal back end. We need this
// data saved somewhere in the portal as a resource to cross check when usages
// are sent and also for future reference for all of the stock control
// processes in the business."
//
// The workbook is Toni's "TechnoMed_Distributor_Price_Lists.xlsx" in Dropbox
// /Admin/Accounts — one tab per distributor in one layout (Product range,
// Product type, Description, Product code, Rebate (PL) code, Price (AUD),
// Price setting, UDI, ARTG, Supply, Notes), KT on two tabs (Private and RHH).
// Dropbox stays the master — Toni edits the spreadsheet there — and the portal
// keeps every line of it in Redis, one key per list, held until the next read
// (no expiry), so a usage check never waits on Dropbox and still works if
// Dropbox is down. Read again by the nightly cron when the file has changed,
// and by Admin → Price lists → Read it again.
//
// INTERNAL ONLY: partner pricing is commercially confidential. Prices are
// served to admins only (guides.js?prices=); the usage check tells a rep only
// whether a code is on the list, its rebate code and range — never a price.
// Nothing here is ever put in an email.

import ExcelJS from 'exceljs'
import { redis, redisSetBody } from './_redis.js'
import { listFolder, downloadFile, dropboxConfigured } from './_dropbox.js'

export const PRICE_FOLDER = process.env.PRICE_LIST_FOLDER || '/Admin/Accounts'
const NAME = /distributor[_\s-]*price[_\s-]*list/i
const META = 'prices:meta'
const LIST = key => `prices:list:${key}`

/** The tabs, by what their names say. KT is split: private hospitals and the RHH. */
export const LISTS = [
  { key: 'signus', test: /signus/i, distributor: 'signus', label: 'Signus' },
  { key: 'e4', test: /\be4\b/i, distributor: 'e4', label: 'E4 Surgical' },
  { key: 'globus', test: /globus|nuvasive/i, distributor: 'globus', label: 'Globus Medical' },
  { key: 'kt-rhh', test: /\bkt\b.*\brhh\b|\brhh\b.*\bkt\b/i, distributor: 'kt', label: 'KT Medical (RHH)', hospital: 'RHH' },
  { key: 'kt-private', test: /\bkt\b/i, distributor: 'kt', label: 'KT Medical (Private)', hospital: 'private' },
  { key: 'device', test: /device/i, distributor: 'device', label: 'Device Technologies' }
]
export const listForSheet = name => LISTS.find(l => l.test.test(String(name || ''))) || null

const text = v => {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') return String(v.text ?? v.result ?? (v.richText ? v.richText.map(r => r.text).join('') : ''))
  return String(v).trim()
}
/** A price as a number, or null for blank / "-" / no charge. $0 is kept as 0. */
const priceOf = v => {
  const s = text(v).replace(/[$,\s]/g, '')
  if (s === '' || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// Stored as arrays to keep each list well under Redis's value limit.
const FIELDS = ['code', 'description', 'range', 'type', 'rebate', 'price', 'setting', 'udi', 'artg', 'supply', 'notes']
const pack = r => FIELDS.map(f => (r[f] ?? ''))
const unpack = a => Object.fromEntries(FIELDS.map((f, i) => [f, f === 'price' ? (a[i] === '' || a[i] == null ? null : Number(a[i])) : a[i] || '']))

/**
 * Every line of every distributor tab. Pure apart from parsing.
 * @returns {{ lists: {[key]: object[]}, notes: {[key]: string} }}
 */
export async function parsePriceBook(buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const lists = {}
  const notes = {}
  wb.eachSheet(ws => {
    const list = listForSheet(ws.name)
    if (!list) return
    let cols = null
    const above = []
    const rows = []
    ws.eachRow(row => {
      const cells = row.values.map(text)
      if (!cols) {
        const at = name => cells.findIndex(c => c && c.toLowerCase().startsWith(name))
        const code = at('product code')
        if (code > 0) {
          cols = { code, price: at('price ('), desc: at('description'), range: at('product range'), type: at('product type'),
            rebate: at('rebate'), setting: at('price setting'), udi: at('udi'), artg: at('artg'), supply: at('supply'), notes: at('notes') }
          if (cols.price < 0) cols.price = at('price')
        } else {
          const said = cells.filter(Boolean).join(' ')
          if (said) above.push(said)
        }
        return
      }
      const get = i => (i > 0 ? cells[i] || '' : '')
      const code = get(cols.code)
      if (!code) return
      rows.push({
        code, description: get(cols.desc), range: get(cols.range), type: get(cols.type),
        rebate: get(cols.rebate), price: cols.price > 0 ? priceOf(row.values[cols.price]) : null,
        setting: get(cols.setting), udi: get(cols.udi), artg: get(cols.artg), supply: get(cols.supply), notes: get(cols.notes)
      })
    })
    if (rows.length) {
      lists[list.key] = [...(lists[list.key] || []), ...rows]
      notes[list.key] = above.slice(1).join(' ').slice(0, 600) // the title row dropped
    }
  })
  return { lists, notes }
}

/** The newest price list workbook in the folder. */
export async function newestPriceFile() {
  const { entries } = await listFolder(PRICE_FOLDER)
  return entries.filter(e => e.kind === 'file' && NAME.test(e.name) && /\.xlsx$/i.test(e.name))
    .sort((a, b) => String(b.modified).localeCompare(String(a.modified)))[0] || null
}

let memo = null
const MEMO_MS = 10 * 60 * 1000

/** What the portal holds: { meta, lists } or null. One MGET, then kept for ten minutes. */
export async function loadPriceBook({ fresh = false } = {}) {
  if (!fresh && memo && Date.now() - memo.at < MEMO_MS) return memo.book
  const keys = [META, ...LISTS.map(l => LIST(l.key))]
  const raws = await redis('mget', ...keys)
  let meta = null
  try { meta = raws?.[0] ? JSON.parse(raws[0]) : null } catch { meta = null }
  if (!meta) return null
  const lists = {}
  LISTS.forEach((l, i) => {
    try { const a = raws[i + 1] ? JSON.parse(raws[i + 1]) : null; if (a) lists[l.key] = a.map(unpack) } catch { /* that list unreadable */ }
  })
  const book = { meta, lists }
  memo = { at: Date.now(), book }
  return book
}

/** Saves a parsed workbook as what the portal holds. */
export async function savePriceBook({ file, modified, by = '' }, { lists, notes }) {
  for (const l of LISTS) {
    if (lists[l.key]) await redisSetBody(LIST(l.key), JSON.stringify(lists[l.key].map(pack)))
    else await redis('del', LIST(l.key)).catch(() => {})
  }
  const meta = {
    file, modified, readAt: new Date().toISOString(), by,
    counts: Object.fromEntries(LISTS.map(l => [l.key, (lists[l.key] || []).length])),
    notes: notes || {}
  }
  await redisSetBody(META, JSON.stringify(meta))
  memo = null
  return meta
}

/**
 * Reads the newest workbook from Dropbox into the portal — only when it has
 * changed since the last read, unless `force`.
 */
export async function refreshPriceBook({ force = false, by = '' } = {}) {
  if (!dropboxConfigured()) return { skipped: 'Dropbox is not connected' }
  const file = await newestPriceFile()
  if (!file) return { skipped: `No price list workbook in ${PRICE_FOLDER}` }
  const now = await loadPriceBook({ fresh: true }).catch(() => null)
  if (!force && now?.meta?.file === file.name && now?.meta?.modified === file.modified) return { unchanged: true, meta: now.meta }
  const parsed = await parsePriceBook(await downloadFile(file.path))
  if (!Object.keys(parsed.lists).length) throw new Error(`${file.name} has no distributor tabs the portal recognises`)
  const meta = await savePriceBook({ file: file.name, modified: file.modified, by }, parsed)
  return { read: true, meta }
}

const codeKey = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Lines matching every word of the search, in code, description or range. Admins only. */
export function searchPriceBook(book, q, { limit = 60 } = {}) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!book || !words.length) return []
  const out = []
  for (const l of LISTS) {
    for (const r of book.lists[l.key] || []) {
      const hay = `${r.code} ${codeKey(r.code)} ${r.description} ${r.range} ${r.rebate}`.toLowerCase()
      if (words.every(w => hay.includes(w))) out.push({ list: l.key, distributor: l.label, ...r })
      if (out.length >= limit) return out
    }
  }
  return out
}
