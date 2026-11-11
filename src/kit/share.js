// ─── Sharing a kit's document (Brent, 11 Nov 2026: "share the consignment
// agreement or tray list from the kit room page with a simple share button") ──
//
// The file itself, through the phone's own share sheet — Mail, Messages,
// WhatsApp, AirDrop — where the phone can share files. Where it cannot (most
// desktops), the file is downloaded instead, so it can be attached by hand.
// The link it is fetched through is temporary; it is never what is shared.

const TYPES = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', txt: 'text/plain', csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

export const typeOfName = name => TYPES[String(name || '').toLowerCase().split('.').pop()] || 'application/octet-stream'

let ready = null

/** Shares the files a refused share left ready — call straight from a tap. */
export async function shareReady({ nav = typeof navigator !== 'undefined' ? navigator : null } = {}) {
  if (!ready) return 'cancelled'
  const { files, title } = ready
  ready = null
  try { await nav.share({ files, title }); return 'shared' } catch (err) { if (err?.name === 'AbortError') return 'cancelled'; throw err }
}

/** What happened, for the screen to say: 'shared' | 'downloaded' | 'cancelled' | 'needs-tap'. */
export async function shareFile({ url, name, title }, opts = {}) {
  return shareFiles([{ url, name }], { title: title || name }, opts)
}

/** Several files in one share (a tray list that came as one PDF per tray). */
export async function shareFiles(items, { title } = {}, { nav = typeof navigator !== 'undefined' ? navigator : null, fetchImpl = fetch } = {}) {
  const files = []
  for (const { url, name } of items) {
    const res = await fetchImpl(url)
    if (!res.ok) throw new Error('The file could not be fetched — try again')
    const blob = await res.blob()
    files.push(new File([blob], name || 'document', { type: blob.type && blob.type !== 'application/octet-stream' ? blob.type : typeOfName(name) }))
  }
  if (nav?.canShare && nav.canShare({ files })) {
    try {
      await nav.share({ files, title: title || files[0]?.name })
      return 'shared'
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled'
      // An iPhone opens the share sheet only straight after a tap, and
      // fetching the file can take longer than it allows. The files are kept
      // ready, and the screen offers one more tap that shares at once.
      if (err?.name === 'NotAllowedError') { ready = { files, title: title || files[0]?.name }; return 'needs-tap' }
      throw err
    }
  }
  for (const file of files) {
    const href = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = href; a.download = file.name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 10000)
  }
  return 'downloaded'
}

/** A tray list as plain text, when its original document was not kept. */
export function trayListText(kitName, list) {
  const lines = [`${kitName} — tray list`, '']
  for (const t of list?.trays || []) {
    lines.push(t.name)
    for (const l of t.lines || []) lines.push(`  ${l.qty ? `${l.qty} × ` : ''}${[l.code, l.description].filter(Boolean).join(' — ')}`)
    lines.push('')
  }
  return lines.join('\n').trim()
}

export async function shareText({ title, text }, { nav = typeof navigator !== 'undefined' ? navigator : null } = {}) {
  if (nav?.share) {
    try { await nav.share({ title, text }); return 'shared' } catch (err) { if (err?.name === 'AbortError') return 'cancelled'; throw err }
  }
  await nav?.clipboard?.writeText(text)
  return 'copied'
}
