// Two-stage cases (Brent, 27 Nov 2026: "This is a two stage procedure. Stage 1
// is a Life Healthcare L5/S1 ALIF which we are not needed for. Stage 2 is ours
// … allow us to view these two stages clearly in the case tab").
//
// Pure. Reads "Stage N" out of the operation and the notes, in either order —
// "Stage 1: L5/S1 ALIF (LHC)" or "LHC ALIF stage 1 then Mariner back up stage
// 2" — and says which stage is ours. Nothing is stored: the operation and the
// notes are already in planSignature, so a change in Google reaches the card.

const OTHER_COMPANY = [
  [/\b(?:LHC|life\s*health\s*care)\b/i, 'Life Healthcare'],
  [/\bstryker\b/i, 'Stryker'],
  [/\b(?:J\s*&\s*J|depuy|synthes)\b/i, 'J&J'],
  [/\bmedtronic\b/i, 'Medtronic'],
  [/\bzimmer\b/i, 'Zimmer'],
  [/\bglobus\b/i, 'Globus']
]
const NOT_US = /\b(?:not\s+(?:ours|us|needed|required)|no\s+TM|TM\s+not\s+(?:needed|required)|we\s+are\s+not\s+needed)\b/i

const STAGE_FIRST = /\bstage\s*([1-4])\s*[:\-–]\s*([^\n;]*?)(?=\s*\bstage\s*[1-4]\b|[\n;]|$)/gi

function cleanText(s) {
  return String(s || '')
    .replace(/\(\s*\)/g, '')
    .replace(/^[\s,.:\-–]+|[\s,.\-–]+$/g, '')
    .replace(/^(?:then|and)\s+/i, '')
    .replace(/\s+(?:then|and)$/i, '')
    .trim()
}

function readFragments(source) {
  const out = []
  const text = String(source || '')
  // "Stage 1: L5/S1 ALIF" — the stage named before what it is.
  for (const m of text.matchAll(STAGE_FIRST)) {
    const body = cleanText(m[2])
    if (body) out.push({ n: Number(m[1]), text: body })
  }
  // "LHC ALIF stage 1 then Mariner back up stage 2" — named after.
  for (const piece of text.split(/\bthen\b|[,;\n]/i)) {
    const m = piece.match(/^(.*?)\bstage\s*([1-4])\s*$/i)
    if (m && cleanText(m[1])) out.push({ n: Number(m[2]), text: cleanText(m[1]) })
  }
  return out
}

function whoDoes(text) {
  for (const [pattern, name] of OTHER_COMPANY) if (pattern.test(text)) return name
  return ''
}

/**
 * @param {{operation?: string, notes?: Array<{text:string}>|string}} c
 * @returns {null | Array<{n:number, text:string, ours:boolean, by:string}>}
 *   null unless the case is staged — two stages named, or the operation itself
 *   says which stage it is.
 */
export function stagesOf(c) {
  const operation = String(c?.operation || '')
  const notes = Array.isArray(c?.notes) ? c.notes.map(n => n?.text || '').join('\n') : String(c?.notes || '')
  const fromOp = readFragments(operation)
  const fromNotes = readFragments(notes)
  if (!fromOp.length && !fromNotes.length) return null

  const byStage = new Map()
  // The operation is the record of what we are doing; it wins over a note.
  for (const f of [...fromOp, ...fromNotes]) {
    const had = byStage.get(f.n)
    if (!had) byStage.set(f.n, { n: f.n, text: f.text, fromOp: fromOp.includes(f), notes: [] })
    else if (!fromOp.includes(f)) had.notes.push(f.text)
  }
  const stages = [...byStage.values()].sort((a, b) => a.n - b.n)
  if (stages.length < 2 && !fromOp.length) return null

  const opStages = new Set(fromOp.map(f => f.n))
  return stages.map(s => {
    const all = [s.text, ...s.notes].join(' ')
    const by = whoDoes(all)
    const notUs = Boolean(by) || NOT_US.test(all)
    // Ours when the operation names it, or nothing says someone else does it.
    const ours = opStages.size ? (opStages.has(s.n) && !NOT_US.test(all)) : !notUs
    const shown = s.text
      .replace(/\b(?:LHC|life\s*health\s*care)\b/i, '')
      .replace(NOT_US, '')
      .replace(/\(\s*[-–]?\s*\)/g, '')
    return { n: s.n, text: cleanText(shown) || s.text, ours, by: ours ? '' : by }
  })
}
