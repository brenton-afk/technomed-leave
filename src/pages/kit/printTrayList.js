// ─── Printing a tray list ─────────────────────────────────────────────────────
// "Ability to print tray lists from portal" — Brent, 3 Nov 2026.
//
// A sheet for a clipboard, not a picture of the phone screen: the kit and where
// it is, then each tray as its own block — code, description, implant or
// instrument, how many there should be — and an empty column to write the count
// or tick the line, which is what a stock-take or a return check is done with.
// A tray never splits across pages if it fits on one.
//
// Built as its own document and printed from a hidden frame, so the app's own
// layout — the fixed shell, the tab bar — never reaches the paper.

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const PLACES = { office: 'TM office / Warehouse', CLV: 'Calvary', RHH: 'RHH' }

/** The printable document, as HTML. `only` prints one tray by name. */
export function trayListHtml(kit, list, { only = '', printedBy = '', at = new Date() } = {}) {
  const trays = (list?.trays || []).filter(t => !only || t.name === only)
  const when = at.toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Hobart' })
  const source = [
    list?.source?.file ? `From ${list.source.file}` : '',
    list?.source?.hospital ? `${PLACES[list.source.hospital] || list.source.hospital}'s copy` : ''
  ].filter(Boolean).join(' · ')

  const block = tray => {
    const implants = tray.lines.filter(l => l.kind === 'implant').length
    return `<section class="tray">
  <h2>${escape(tray.name)}</h2>
  <p class="meta">${tray.lines.length} lines · ${implants} implant${implants === 1 ? '' : 's'} counted · instruments ticked</p>
  <table>
    <colgroup><col class="code"><col><col class="kind"><col class="qty"><col class="check"></colgroup>
    <thead><tr><th>Code</th><th>Description</th><th>Type</th><th class="num">Qty</th><th class="num">Count / ✓</th></tr></thead>
    <tbody>${tray.lines.map(l => `
      <tr class="${l.kind === 'implant' ? 'implant' : ''}">
        <td>${escape(l.code || '—')}</td>
        <td>${escape(l.description)}</td>
        <td>${l.kind === 'implant' ? 'Implant' : 'Instrument'}</td>
        <td class="num">${escape(l.qty)}</td>
        <td class="num box"></td>
      </tr>`).join('')}
    </tbody>
  </table>
</section>`
  }

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escape(kit?.name || 'Tray list')} — tray list</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.35 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #0f1e2b; margin: 0; }
  header { border-bottom: 2px solid #042746; padding-bottom: 6px; margin-bottom: 10px; }
  h1 { font-size: 16pt; margin: 0; color: #042746; }
  .sub { color: #4b5b68; margin-top: 2px; }
  .tray { break-inside: avoid; page-break-inside: avoid; margin-bottom: 14px; }
  h2 { font-size: 12pt; margin: 0 0 2px; }
  .meta { color: #6b7a88; margin: 0 0 4px; font-size: 9pt; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  col.code { width: 22%; } col.kind { width: 13%; } col.qty { width: 8%; } col.check { width: 14%; }
  th { text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; color: #4b5b68; border-bottom: 1px solid #93a1ad; padding: 3px 4px; }
  td { padding: 4px; border-bottom: 1px solid #e4e9ee; vertical-align: top; overflow-wrap: anywhere; }
  tr.implant td { font-weight: 600; }
  .num { text-align: right; }
  td.box { border: 1px solid #93a1ad; }
  footer { color: #93a1ad; font-size: 8.5pt; margin-top: 8px; }
</style></head>
<body>
  <header>
    <h1>${escape(kit?.name || 'Tray list')}</h1>
    <div class="sub">${[kit?.at ? `At ${escape(PLACES[kit.at] || kit.at)}` : '', escape(source)].filter(Boolean).join(' · ')}</div>
  </header>
  ${trays.length ? trays.map(block).join('\n') : '<p>No trays on this list.</p>'}
  <footer>Printed ${escape(when)}${printedBy ? ` by ${escape(printedBy)}` : ''} from the TechnoMed portal · Checked by ____________ · Date ____________</footer>
</body></html>`
}

/**
 * Prints it. A hidden frame where the browser allows one; a new window
 * otherwise (some phones will not print a frame).
 */
export function printTrayList(kit, list, opts = {}) {
  const html = trayListHtml(kit, list, opts)
  if (typeof document === 'undefined') return false
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(frame)
  const doc = frame.contentWindow?.document
  if (!doc) {
    frame.remove()
    const view = window.open('', '_blank')
    if (!view) return false
    view.document.write(html)
    view.document.close()
    view.focus()
    view.print()
    return true
  }
  doc.open()
  doc.write(html)
  doc.close()
  const go = () => {
    try {
      frame.contentWindow.focus()
      frame.contentWindow.print()
    } finally {
      setTimeout(() => frame.remove(), 60000)
    }
  }
  if (doc.readyState === 'complete') setTimeout(go, 50)
  else frame.onload = go
  return true
}
