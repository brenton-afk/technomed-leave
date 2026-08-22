// ─── .docx export ─────────────────────────────────────────────────────────────
// Regenerates the emailed document from the same WeekPlan the screen renders.
// Monday–Friday only, per the email convention — weekends are in-app only (§8).
//
// Every TextRun sets `font: 'Arial'` explicitly. docx-js and LibreOffice
// otherwise fall back to a serif heading font, and the reference document is
// not serif.

import {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle,
  Table, TableRow, TableCell, WidthType, ShadingType
} from 'docx'
import { SURGEON_ACCENTS, TOKENS, DOCX_FONT, accentTextFor } from './theme.js'
import { formatDayHeading, formatTimeRange, formatStamp } from './week.js'
import { DOCX_FILENAME } from './exportMeta.js'

export { DOCX_FILENAME }

// docx wants hex without the leading '#'.
const hex = c => String(c).replace('#', '').toUpperCase()

function run(text, opts = {}) {
  return new TextRun({ text, font: DOCX_FONT, ...opts })
}

function para(children, opts = {}) {
  return new Paragraph({ children: Array.isArray(children) ? children : [children], ...opts })
}

// The left border keeps the document's exact accent; the surgeon's name uses
// the AA-safe variant, since Word renders it as body text on white.
function accent(surgeon) {
  return hex(SURGEON_ACCENTS[surgeon] || TOKENS.neutralBar)
}
function accentText(surgeon) {
  return hex(SURGEON_ACCENTS[surgeon] ? accentTextFor(surgeon) : TOKENS.neutralBar)
}

// A single-cell table is how a bordered/shaded callout is expressed in docx.
function calloutBox(children, { bg, border }) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: hex(border) },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: hex(border) },
      left: { style: BorderStyle.SINGLE, size: 6, color: hex(border) },
      right: { style: BorderStyle.SINGLE, size: 6, color: hex(border) },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
    },
    rows: [new TableRow({
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: hex(bg) },
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        children
      })]
    })]
  })
}

function caseParagraphs(c) {
  const out = [
    para([
      run(c.patient, { bold: true, color: hex(TOKENS.ink), size: 22 }),
      run(' / ', { color: hex(TOKENS.inkFaint), size: 22 }),
      run(c.surgeon, { bold: true, color: accentText(c.surgeon), size: 22 })
    ], {
      spacing: { before: 100, after: 0 },
      // The coloured left bar becomes a left border on the block.
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: accent(c.surgeon), space: 8 } }
    }),
    para(run(c.procedure, { color: hex(TOKENS.ink), size: 21 }), {
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: accent(c.surgeon), space: 8 } }
    })
  ]
  if (c.kit) {
    out.push(para(run(`Kit: ${c.kit}`, { color: hex(TOKENS.inkMuted), size: 20 }), {
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: accent(c.surgeon), space: 8 } }
    }))
  }
  const time = formatTimeRange(c.start, c.end)
  if (time) {
    out.push(para(run(time, { color: hex(TOKENS.inkMuted), size: 20 }), {
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: accent(c.surgeon), space: 8 } }
    }))
  }
  for (const note of c.notes || []) {
    const isAlert = note.kind === 'colourCoding' || note.kind === 'clinicalAlert'
    out.push(para(run(note.text, {
      italics: true, bold: isAlert, size: 19,
      color: hex(isAlert ? TOKENS.alert : TOKENS.inkFaint)
    }), {
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: accent(c.surgeon), space: 8 } }
    }))
  }
  return out
}

function dayChildren(day) {
  const out = [
    para(run(formatDayHeading(day.date), { bold: true, color: hex(TOKENS.ink), size: 24 }),
      { spacing: { before: 260, after: 20 } }),
    para(run(day.caseCountLine, { color: hex(TOKENS.inkFaint), size: 20 }), { spacing: { after: 80 } })
  ]

  for (const flag of day.flags) {
    if (flag.boxed) {
      out.push(calloutBox(
        [para(run(`■ ${flag.text}`, { bold: true, color: hex(TOKENS.flagText), size: 20 }))],
        { bg: TOKENS.flagBg, border: TOKENS.flagBorder }
      ))
      out.push(para(run('', { size: 8 })))
    } else {
      const colour = flag.kind === 'clinicalAlert' ? TOKENS.alert : TOKENS.flagText
      out.push(para(run(`■ ${flag.text}`, { bold: true, color: hex(colour), size: 20 })))
    }
  }

  for (const group of day.casesByHospital) {
    out.push(para(run(group.hospital.toUpperCase(), {
      bold: true, color: hex(TOKENS.inkFaint), size: 18, allCaps: true
    }), { spacing: { before: 160, after: 40 } }))
    for (const c of group.cases) out.push(...caseParagraphs(c))
  }

  for (const item of day.nonSurgeonItems) {
    out.push(para(run(item.text, { bold: true, color: hex(TOKENS.ink), size: 21 }), {
      spacing: { before: 100 },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: hex(TOKENS.neutralBar), space: 8 } }
    }))
  }

  if (day.otherRollup.length) {
    out.push(para(run(`Other: ${day.otherRollup.map(o => o.text).join(' · ')}`, {
      italics: true, color: hex(TOKENS.inkFaint), size: 19
    }), { spacing: { before: 100 } }))
  }

  return out
}

/**
 * @param {import('./types.js').WeekPlan} plan
 * @returns {Promise<Blob>} the .docx, Monday–Friday only
 */
export async function buildPlanDocx(plan) {
  const weekdays = plan.days.slice(0, 5)

  const children = [
    para(run(plan.title, { bold: true, color: hex(TOKENS.ink), size: 34 }), { spacing: { after: 60 } }),
    para(run(plan.subtitle, { italics: true, color: hex(TOKENS.inkMuted), size: 21 }), { spacing: { after: 80 } }),
    para(run(plan.summaryLine, { color: hex(TOKENS.inkFaint), size: 20 }), { spacing: { after: 160 } })
  ]

  if (plan.surgeons.length) {
    children.push(para([
      run('Surgeons this week: ', { color: hex(TOKENS.inkMuted), size: 20 }),
      ...plan.surgeons.flatMap((s, i) => [
        run(s, { bold: true, color: accentText(s), size: 20 }),
        run(i < plan.surgeons.length - 1 ? '   ' : '', { size: 20 })
      ])
    ], { spacing: { after: 160 } }))
  }

  if (plan.notes) {
    children.push(calloutBox([
      para(run('Notes', { bold: true, color: hex(TOKENS.ink), size: 20 })),
      para(run(plan.notes, { color: hex(TOKENS.inkMuted), size: 20 }))
    ], { bg: TOKENS.notesBg, border: TOKENS.notesBorder }))
  }

  for (const day of weekdays) children.push(...dayChildren(day))

  if (plan.keyFlags.length) {
    children.push(para(run('Key flags for the week', { bold: true, color: hex(TOKENS.ink), size: 24 }),
      { spacing: { before: 300, after: 100 } }))
    for (const flag of plan.keyFlags) {
      children.push(para([
        run(`${flag.label}: `, { bold: true, color: hex(TOKENS.ink), size: 20 }),
        run(flag.text, { color: hex(TOKENS.inkMuted), size: 20 })
      ], { spacing: { after: 80 } }))
    }
  }

  children.push(para(run('', { size: 2 }), {
    spacing: { before: 240 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: hex(TOKENS.notesBorder), space: 6 } }
  }))
  children.push(para(run(
    'Generated from bookings@technomed.com.au and Staff Leave calendar entries. '
    + 'Planning week runs Monday–Sunday: this document shows next week from Friday onward, '
    + 'and the current week on the Monday–Thursday syncs. '
    + `Last generated: ${formatStamp(plan.lastGeneratedAt)}`,
    { italics: true, color: hex(TOKENS.inkFaint), size: 17 }
  ), { alignment: AlignmentType.CENTER, spacing: { before: 120 } }))

  const doc = new Document({
    // Arial as the document default too, so anything not explicitly run-styled
    // still lands sans-serif.
    styles: { default: { document: { run: { font: DOCX_FONT, size: 20 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4 in twips
          margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 }
        }
      },
      children
    }]
  })

  return Packer.toBlob(doc)
}

