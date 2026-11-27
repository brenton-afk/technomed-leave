// ─── The Mariner Outrigger on standby (Brent, 19 Nov 2026) ───────────────────
// "Build in a rule that extension, revision and connecting cases get an
// automatic allocation of Mariner outrigger as a DNO (Do not open) tray. This
// means it's on stand by for the case. At Calvary it lives on shelf as a
// consignment. If the extension case is at RHH, it will need to be flagged
// that the kit needs to be transferred from Calvary to RHH."
//
// Added to the kit line as "Mariner Outrigger (DNO)" by writeBooking and by
// Edit booking whenever hospital, operation or kit change — the same places
// AIRO is added (brainlab.js). The supply is then set by the day like any
// other system (kitWithDaySupplies): Consignment at Calvary, Calvary Loan at
// RHH, which the week turns into "Transfer the Mariner Outrigger kit from
// Calvary to RHH" the working day before (tmLoanDispatches in dispatch.js).
//
// The Outrigger connects to an existing posterior construct, so a case that
// is only anterior or only cervical (an ACDF revision) is left alone, and so
// is a removal on its own. "No Outrigger" in the notes leaves it off; a kit
// line that already names it is never changed.

const SIGN = /\b(?:extension|extend(?:ed|ing|s)?(?:\s+(?:up|down))?|revision|revis(?:e|ed|ing)|re-?do|connect(?:ing|ion|s|ed)?\s+(?:on)?to\b|connect(?:ing|ion)\s+(?:with|onto)\b|(?:existing|old|previous)\s+(?:construct|hardware|instrumentation|fixation|rods?))\b/i
const ANTERIOR_ONLY = /\b(?:acdf|accf|alif|olif|xlif|llif|corpectomy|disc\s*replacement|arthroplasty|anterior)\b/i
const POSTERIOR = /\b(?:pedicle|posterior|psf|plif|tlif|fixation|fusion|screws?|rods?|construct|instrumentation|s2ai|lateral\s*mass)\b/i
const LEVEL = /\b([CTLS])\d{1,2}\b/gi
const REMOVAL_ONLY = /\b(?:remov(?:al|e)|r\/o|romw)\b/i
const OPTED_OUT = /\bno\s+(?:mariner\s+)?outrigger\b|\boutrigger\s+(?:is\s+)?not\s+(?:required|needed|req'?d)\b/i
const HAS_OUTRIGGER = /\boutrigger\b/i
// Brent, 27 Nov 2026: a "stereotactic redo craniotomy" got the Outrigger —
// "redo" alone was enough. It is a spinal kit: the operation must say spine
// (a thoracolumbar level, or a posterior spine word), and nothing cranial.
const CRANIAL = /\b(?:crani\w*|burr\s*holes?|shunts?|stereotactic|sterotactic|biops\w*|tumou?r|lesion|aneurysm|subdural|cranial|brain|skull|ventric\w*|evd|dbs|transsphenoidal|pituitary)\b/i
const SPINE_WORDS = /\b(?:spin\w*|lumbar|thoracic|thoracolumbar|sacr\w*|pelvi\w*|iliac)\b/i

export const OUTRIGGER_KIT = 'Mariner Outrigger (DNO)'

/** Whether the operation is an extension, revision or connection to an existing construct, posteriorly. Pure. */
export function needsOutrigger({ procedure, notes } = {}) {
  const op = String(procedure || '')
  if (!SIGN.test(op)) return false
  if (OPTED_OUT.test(`${op}\n${notes || ''}`)) return false
  // A removal alone — nothing new to connect.
  if (REMOVAL_ONLY.test(op) && !SIGN.test(op.replace(REMOVAL_ONLY, ''))) return false
  // Only cervical levels named: not a Mariner case.
  const regions = new Set([...op.matchAll(LEVEL)].map(m => m[1].toUpperCase()))
  if (regions.size && [...regions].every(r => r === 'C')) return false
  const thoracolumbar = [...regions].some(r => r !== 'C')
  // Cranial work is never a Mariner case, whatever it says about a redo.
  if (CRANIAL.test(op) && !thoracolumbar) return false
  // It has to say spine somewhere: a level below the neck, a spine word, or
  // a posterior construct word.
  if (!thoracolumbar && !SPINE_WORDS.test(op) && !POSTERIOR.test(op)) return false
  // Anterior only (an ACDF or ALIF revision) — the Outrigger is posterior.
  if (ANTERIOR_ONLY.test(op) && !POSTERIOR.test(op.replace(ANTERIOR_ONLY, ''))) return false
  return true
}

/** The kit line with the Outrigger on standby added, where the rule says so. Pure. */
export function kitWithAutoOutrigger({ procedure, kit, notes } = {}) {
  const line = String(kit || '').trim()
  if (HAS_OUTRIGGER.test(line) || !needsOutrigger({ procedure, notes })) return String(kit || '')
  return line ? `${line} / ${OUTRIGGER_KIT}` : OUTRIGGER_KIT
}
