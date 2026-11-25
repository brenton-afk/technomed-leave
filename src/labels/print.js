// Making and printing the label PDF in the browser. Each label is drawn by
// Fabric (the editor's own renderer) at 600 dpi once the label fonts are in,
// then pdf.js lays one per 68 × 21 mm page.

import { loadFabric, renderLabelPng } from './editorCanvas.js'
import { loadLabelFonts } from './fonts.js'
import { buildLabelPdf } from './pdf.js'
import { shareFileObjects } from '../kit/share.js'
import { isAppleMobile } from '../pages/kit/trayListPdf.js'

/** jobs: [{ label, qty }] → a PDF Blob. */
export async function makeLabelPdf(jobs, logos, { onProgress } = {}) {
  await loadLabelFonts()
  const fabric = await loadFabric()
  fabric.cache?.clearFontCache?.()
  const pngs = []
  let n = 0
  for (const job of jobs) {
    if (!(Number(job.qty) > 0)) continue
    onProgress?.(`Drawing ${job.label.name} (${++n} of ${jobs.length})…`)
    pngs.push({ png: await renderLabelPng(fabric, job.label, logos), qty: job.qty, name: job.label.name })
  }
  onProgress?.('Making the PDF…')
  const title = jobs.length === 1 ? `${jobs[0].label.name} × ${jobs[0].qty}` : `TechnoMed labels (${jobs.length})`
  const bytes = await buildLabelPdf(pngs, { title })
  return new Blob([bytes], { type: 'application/pdf' })
}

export const pdfName = jobs => `${(jobs.length === 1 ? jobs[0].label.name : 'TechnoMed labels').replace(/[^\w .()-]+/g, '').trim() || 'labels'}.pdf`

export function downloadPdf(blob, name) {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 30000)
}

/**
 * Opens the system print dialog on the PDF. A computer prints it from a
 * hidden frame; an iPhone (which ignores a page's print) gets the share sheet,
 * whose Print goes to the printer. Returns what happened.
 */
export async function printPdf(blob, name) {
  if (isAppleMobile()) {
    return shareFileObjects([new File([blob], name, { type: 'application/pdf' })], { title: name })
  }
  const href = URL.createObjectURL(blob)
  const frame = document.createElement('iframe')
  frame.setAttribute('data-label-print', '')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0'
  frame.src = href
  document.body.appendChild(frame)
  await new Promise(resolve => { frame.onload = resolve; setTimeout(resolve, 4000) })
  try {
    frame.contentWindow.focus()
    frame.contentWindow.print()
  } catch {
    window.open(href, '_blank')
  }
  setTimeout(() => { frame.remove(); URL.revokeObjectURL(href) }, 60000)
  return 'printed'
}

export function openPdf(blob) {
  const href = URL.createObjectURL(blob)
  window.open(href, '_blank')
  setTimeout(() => URL.revokeObjectURL(href), 120000)
}
