import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { Packer } from 'docx'
import JSZip from 'jszip'
import { agendaWordDoc, WORD } from './Agenda.jsx'

// Brent, 12 Nov 2026: the export copies Erin's own agenda document.
const agenda = {
  title: 'TechnoMed Staff Meeting', date: '2026-11-25', time: '12:00pm – 1:30pm', location: 'TechnoMed office and Google Meet',
  attendees: 'Erin Smallbon, Mat Usher', apologies: 'Toni Hoppitt', chair: 'Erin Smallbon',
  items: [{ id: 'w', title: 'Welcome and apologies', points: [], lead: 'Erin' }, { id: 'g', title: 'General business', points: [] },
    { id: 's', title: 'Stocktake planning', points: ['Signus stocktake from Tuesday 1 December', 'E4 stocktake on 27 January'], lead: '' },
    { id: 'n', title: 'Next meeting', points: [] }]
}
const actions = { since: { date: '2026-10-28' }, notDone: [{ task: 'Chase plate ETA', assignee: 'Mat Usher', due_date: '2026-11-09', overdue: true }] }

describe('the agenda in Word', () => {
  it('has Erin\'s header, footer, colours, font and tables', async () => {
    const buf = await Packer.toBuffer(await agendaWordDoc(agenda, actions))
    if (process.env.AGENDA_DOCX_OUT) writeFileSync(process.env.AGENDA_DOCX_OUT, buf)
    const zip = await JSZip.loadAsync(buf)
    const doc = await zip.file('word/document.xml').async('string')
    const header = Object.keys(zip.files).filter(f => /word\/header\d*\.xml/.test(f))
    const footer = Object.keys(zip.files).filter(f => /word\/footer\d*\.xml/.test(f))
    const head = await zip.file(header[0]).async('string')
    const foot = await zip.file(footer[0]).async('string')
    expect(head).toContain('Surgical Solutions &amp; Support')
    expect(foot).toContain('295 Elizabeth Street, North Hobart TAS 7000')
    expect(doc).toContain(`w:fill="${WORD.navy}"`)
    expect(doc).toContain(`w:fill="${WORD.teal}"`)
    expect(doc).toContain(`w:fill="${WORD.label}"`)
    expect(doc).toContain('Montserrat')
    for (const t of ['Discussion points', 'Staff meeting', 'Actions not yet completed', 'Chase plate ETA', 'Actions arising', 'Signus stocktake from Tuesday 1 December']) expect(doc).toContain(t)
  })
})
