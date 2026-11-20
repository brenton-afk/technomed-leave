import { describe, it, expect } from 'vitest'
import { PDFDocument, PDFName } from 'pdf-lib'
import { buildScanPdf, stampLines } from './_usagePdf.js'

async function onePagePdf() {
  const doc = await PDFDocument.create()
  doc.addPage([595, 842])
  return Buffer.from(await doc.save()).toString('base64')
}

describe('the received stamp on a resupply (Toni, 20 Nov 2026)', () => {
  it('says the day received, in Hobart, and the uploader\'s initials', () => {
    // 2pm UTC on 20 Nov is 1am on the 21st in Hobart.
    expect(stampLines({ at: new Date('2026-11-20T14:00:00Z'), name: 'Test Person' }))
      .toEqual(['RECEIVED 21 Nov 2026', 'UPLOADED BY TP'])
  })

  it('stamps an uploaded PDF, and leaves an unstamped one as it came', async () => {
    const data = await onePagePdf()
    const plain = await buildScanPdf([{ mediaType: 'application/pdf', data }])
    expect(plain.toString('base64')).toBe(data)
    const stamped = await buildScanPdf([{ mediaType: 'application/pdf', data }], { stamp: ['RECEIVED 20 Nov 2026', 'UPLOADED BY TP'] })
    // The stamp's bold font is on the first page's resources.
    const page = (await PDFDocument.load(new Uint8Array(stamped))).getPages()[0]
    const fonts = page.node.Resources().lookup(PDFName.of('Font'))
    expect(fonts && fonts.keys().length).toBeGreaterThan(0)
    expect((await PDFDocument.load(new Uint8Array(stamped))).getPageCount()).toBe(1)
  })
})
