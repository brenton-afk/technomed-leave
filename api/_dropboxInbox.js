// ─── Files Claude hands to Dropbox through the portal (Brent, 24 Nov 2026) ──
// "I want you to put the device price list into Dropbox." Claude's own Dropbox
// tools write plain text only, so a spreadsheet cannot go straight in. Claude
// writes a delivery note instead — a .json text file in /Admin/Claude Inbox
// holding the file as base64, where it goes, its SHA-256, and the content hash
// of the file it replaces — and the portal, which holds a full Dropbox
// connection, writes the real file.
//
// Narrow on purpose: only into ALLOWED folders, never the usage tree; the bytes
// must match the SHA-256; and a file being replaced must still be exactly the
// one Claude started from (`replaces` = its Dropbox content_hash), so somebody's
// later edit is never overwritten — that delivery is refused and left in place.
// Dropbox keeps the replaced version in its history. The note is deleted once
// delivered. Runs before the price list is read (Read it again, nightly cron).

import { createHash } from 'node:crypto'
import ExcelJS from 'exceljs'
import { redis } from './_redis.js'
import { listFolder, downloadFile, uploadFile, fileMetadata, deletePath } from './_dropbox.js'

export const INBOX = '/Admin/Claude Inbox'
export const ALLOWED = ['/admin/accounts/']
const LOG = 'dropbox:inbox:log'

const OPS = new Set(['appendRows', 'replaceInFormulas', 'setCell', 'autoFilter'])

/**
 * Checks a delivery note. Returns { error } or { path, bytes, replaces } for a
 * whole file, or { path, edits, replaces } for edits to a workbook already
 * there (kind 'edit' — a few lines, not 360k characters of base64). Pure.
 */
export function readDelivery(json) {
  let d
  try { d = typeof json === 'string' ? JSON.parse(json) : json } catch { return { error: 'not JSON' } }
  const path = String(d?.path || '')
  if (!path.startsWith('/') || path.includes('..') || path.includes('\\')) return { error: 'bad path' }
  const lower = path.toLowerCase()
  if (!ALLOWED.some(a => lower.startsWith(a))) return { error: 'path not allowed' }
  if (lower.startsWith('/all surgeon usage')) return { error: 'path not allowed' }
  if (d?.kind === 'edit') {
    if (!/\.xlsx$/i.test(path)) return { error: 'edits are for .xlsx only' }
    if (!d.replaces) return { error: 'an edit must say which version it edits' }
    const edits = Array.isArray(d.edits) ? d.edits : []
    if (!edits.length || edits.some(e => !OPS.has(e?.op) || !e.sheet)) return { error: 'bad edits' }
    return { path, edits, replaces: String(d.replaces) }
  }
  const bytes = Buffer.from(String(d?.base64 || ''), 'base64')
  if (!bytes.length) return { error: 'empty file' }
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (sha !== String(d?.sha256 || '').toLowerCase()) return { error: 'checksum does not match' }
  return { path, bytes, replaces: d?.replaces ? String(d.replaces) : null }
}

/** Delivers every note in the inbox. Returns what happened to each. */
export async function deliverInbox() {
  const { entries, missing } = await listFolder(INBOX).catch(() => ({ entries: [], missing: true }))
  if (missing) return []
  const out = []
  for (const e of entries.filter(x => x.kind === 'file' && /\.json$/i.test(x.name))) {
    const notePath = `${INBOX}/${e.name}`
    try {
      const d = readDelivery((await downloadFile(notePath)).toString('utf8'))
      if (d.error) { out.push({ note: e.name, error: d.error }); continue }
      if (d.replaces) {
        const now = await fileMetadata(d.path)
        if (now && now.content_hash !== d.replaces) {
          out.push({ note: e.name, error: 'the file has changed since — not replaced' })
          continue
        }
      }
      const bytes = d.edits ? await editWorkbook(await downloadFile(d.path), d.edits) : d.bytes
      await uploadFile(d.path, bytes)
      await deletePath(notePath)
      out.push({ note: e.name, delivered: d.path })
    } catch (err) {
      out.push({ note: e.name, error: err.message })
    }
  }
  if (out.length) {
    await redis('lpush', LOG, JSON.stringify({ at: new Date().toISOString(), out })).catch(() => {})
    await redis('ltrim', LOG, '0', '49').catch(() => {})
  }
  return out
}

/**
 * Applies edits to a workbook and returns its bytes. exceljs keeps Toni's
 * workbook as it is (checked cell by cell, 24 Nov 2026: values, formulas,
 * formats, fills, widths, filters). appendRows copies the last row's style;
 * a string starting "=" is a formula.
 */
export async function editWorkbook(buffer, edits) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  for (const e of edits) {
    const ws = wb.getWorksheet(e.sheet)
    if (!ws) throw new Error(`no sheet ${e.sheet}`)
    if (e.op === 'appendRows') {
      // After the last row with anything in it — counted once, then stepped,
      // since a row only counts once it holds a value.
      let n = 0
      ws.eachRow({ includeEmpty: false }, (r, i) => { if (i > n) n = i })
      const last = ws.getRow(n)
      for (const cells of e.rows || []) {
        n += 1
        const row = ws.getRow(n)
        cells.forEach((v, i) => {
          const c = row.getCell(i + 1)
          c.value = typeof v === 'string' && v.startsWith('=') ? { formula: v.slice(1) } : v
          c.style = JSON.parse(JSON.stringify(last.getCell(i + 1).style || {}))
        })
        if (last.height) row.height = last.height
        row.commit()
      }
    } else if (e.op === 'replaceInFormulas') {
      ws.eachRow(row => row.eachCell(c => {
        const f = c.value && typeof c.value === 'object' && c.value.formula
        if (f && (!e.contains || f.includes(e.contains)) && f.includes(e.find)) {
          c.value = { formula: f.split(e.find).join(e.replace) }
        }
      }))
    } else if (e.op === 'setCell') {
      ws.getCell(e.cell).value = e.value
    } else if (e.op === 'autoFilter') {
      ws.autoFilter = e.ref
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}
