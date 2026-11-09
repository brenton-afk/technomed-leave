import React, { useEffect, useState } from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'
import { FileViewer } from '../Chat.jsx'

// ─── A past usage's own files (Brent, 9 Nov 2026) ────────────────────────────
// "You should be able to tap the usage from past scanned usages and see your
// scanned files." The files the portal filed for this case — the scan, the
// sheet, an amended sheet, the Boost tracking form — listed from the record,
// each opened through action=open, which only opens what the portal itself
// filed (the rest of the usage tree stays locked until the redaction is done).
// A PDF or photo is shown in the portal's own viewer; a spreadsheet downloads.

const kindOf = name => (/\.pdf$/i.test(name) ? 'application/pdf' : /\.(jpe?g)$/i.test(name) ? 'image/jpeg' : /\.png$/i.test(name) ? 'image/png' : '')
const label = name => {
  if (/Boost_Tracking_Form/i.test(name)) return 'Boost tracking form'
  if (/amended_(\d+)/i.test(name)) return `Amended sheet ${name.match(/amended_(\d+)/i)[1]}`
  if (/Usage_Scan/i.test(name)) return 'Scanned form'
  if (/Usage_Sheet/i.test(name)) return 'Usage sheet'
  if (/resupply/i.test(name)) return 'Resupply'
  return name
}

export default function CaseFiles({ usage, user }) {
  const [opening, setOpening] = useState('')
  const [error, setError] = useState('')
  const [viewing, setViewing] = useState(null) // { url, name, type }
  const files = usage.filesSaved || []

  // An object URL made for the viewer is let go when it closes.
  useEffect(() => () => { if (viewing?.url?.startsWith('blob:')) URL.revokeObjectURL(viewing.url) }, [viewing])

  async function open(name) {
    setOpening(name); setError('')
    try {
      const path = `${String(usage.dropboxPath || '').replace(/\/+$/, '')}/${name}`
      const res = await fetch(`/api/usage/agent?action=open&path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${user?.token || ''}` }
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) throw new Error(data.error || 'That file could not be opened')
      const type = kindOf(name)
      if (!type) { window.location.assign(data.url); return } // a spreadsheet: download it
      try {
        const blob = await (await fetch(data.url)).blob()
        setViewing({ url: URL.createObjectURL(new Blob([blob], { type })), name, type })
      } catch {
        window.open(data.url, '_blank', 'noopener') // the link still works if the preview cannot
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setOpening('')
    }
  }

  return (
    <div data-case-files style={{ marginTop: space.sm, paddingTop: space.sm, borderTop: `1px solid ${colour.lineSoft}` }}>
      {!usage.dropboxPath || files.length === 0
        ? <div style={{ ...text('caption'), color: colour.inkFaint }}>No files were filed in Dropbox for this scan.</div>
        : files.map(name => (
          <button key={name} type="button" onClick={() => open(name)} disabled={Boolean(opening)} data-case-file={name}
            style={{
              display: 'flex', width: '100%', alignItems: 'center', gap: space.sm, minHeight: 44, padding: `${space.xs}px 0`,
              background: 'none', border: 'none', borderBottom: `1px solid ${colour.lineSoft}`, cursor: 'pointer', textAlign: 'left'
            }}>
            <span style={{ ...text('bodyStrong'), color: colour.ink, flex: 1 }}>{label(name)}</span>
            <span style={{ ...text('caption'), color: colour.accent }}>
              {opening === name ? 'Opening…' : kindOf(name) ? 'View' : 'Download'}
            </span>
          </button>
        ))}
      {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginTop: space.xs }}>{error}</div>}
      {viewing && <FileViewer file={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
