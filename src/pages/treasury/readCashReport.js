// ─── Reading a SelfWealth cash report on the phone ───────────────────────────
// The PDF stays on the phone. What goes to the server is its text, each piece
// with its page and position, because the report is a table and position is
// what says whether an amount is a credit, a debit or the balance. The parsing
// itself is in src/treasury/selfwealth.js, on the server.

export async function readCashReport(file) {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const items = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue
      items.push({ p, x: Math.round(it.transform[4] * 10) / 10, y: Math.round(it.transform[5] * 10) / 10, s: it.str })
    }
  }
  return items
}
