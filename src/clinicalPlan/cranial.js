// ─── A cranial case never gets spinal kit (Brent, 27 Nov 2026) ──────────────
// "It must not mix in spine implants into cranial bookings — that's a bad
// mistake." A stereotactic redo craniotomy had been given the Mariner
// Outrigger because it said "redo". This is the one test every automatic kit
// rule asks first: the Outrigger, the surgeon's usual system, the system
// buttons' suggestions, a kit assumed from an email, and the in-situ hardware
// check. A person can still add a system by hand.
//
// Cranial = a brain / skull / pituitary operation, unless the same operation
// names the spine too (a level, a spinal word, or a spinal implant word) —
// "posterior fossa decompression and C1 laminectomy" is left to the spine
// rules. "Cranially" on its own is a direction on the spine ("extend the
// construct cranially"), never cranial surgery.

const CRANIAL = /\b(?:craniotom\w*|craniectom\w*|cranioplast\w*|craniofacial|cranial\s+(?:vault|base|nerve|registration)|burr\s*holes?|shunts?|ventric\w*|evd|stereotac\w*|sterotac\w*|brain|glioma|meningioma|glioblastoma|gbm|tumou?r|lesion|metastas\w*|aneurysm\w*|avm|arteriovenous|subdural|extradural\s+haem\w*|haematoma|hematoma|pituitar\w*|prolactinoma|trans\s*-?\s*sphenoid\w*|transphenoid\w*|endoscopic\s+endonasal|dbs|deep\s+brain|intracranial|skull|posterior\s+fossa|chiari|biops\w*)\b/i
const SPINE = /\b(?:[CTLS]\d{1,2}(?:\s*[-\/]\s*[CTLS]?\d{1,2})?|spin\w*|cervical|thoracic|lumbar|sacr\w*|coccyx|pelvi\w*|iliac|acdf|accf|alif|plif|tlif|xlif|olif|llif|psf|pedicle|lateral\s+mass|laminectomy|laminoplasty|discectomy|microdiscectomy|foraminotomy|corpectomy|fusion|fixation|rods?|cages?|kyphoplasty|vertebroplasty|sij|si\s+joint|construct|instrumentation|screws?)\b/i

/** Whether an operation is cranial with nothing spinal in it. Pure. */
export function isCranialCase(operation) {
  const t = String(operation || '')
  return CRANIAL.test(t) && !SPINE.test(t)
}
