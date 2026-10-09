// ─── Where each system's kit is coming from ──────────────────────────────────
// "I need a Loan/Consignment button from within the booking editor so we can
// tap that instead of having to write what kit we are using for each case. The
// options should be RHH Loan, Distributor Loan and Consignment. It should be
// separated by system — we might use Consignment Ascot and RHH Loan Athlet for
// an Ascot/Athlet case at Calvary, because Ascot lives at Calvary but Athlet
// doesn't."
//
// Three answers, and the difference between them is who has to do something:
//
//   Consignment      it is already at the hospital. Nobody does anything.
//   TM Loan          one of ours, off the shelf at the office. Somebody puts
//                    it in a car — the Shoreline and the Dakota loan kits sit
//                    there, and a case covered by one needs no request at all.
//   RHH Loan         we move it ourselves, from RHH to the other hospital. A
//                    job for our team on a particular morning, and the thing
//                    most likely to be forgotten because it involves nobody
//                    outside.
//   Distributor Loan somebody has to request it and chase it. A lead time, and
//                    a phone call if it has not arrived.
//
// They used to be two — "Loan" covered the last two — which hid exactly the
// distinction that decides whether a tray turns up.
//
// Per system, because one case is often two systems with different answers,
// which is the whole reason the field could not just be a single choice.

/** The three, in the order they appear on the buttons. */
import { isNavigationOnly } from './systems.js'

export const SUPPLY_OPTIONS = [
  'Consignment', 'TM Loan', 'RHH Loan', 'Distributor Loan'
]

const SPLIT = /\s*[/,]\s*|\s+\+\s+/

/**
 * Reads "Mariner (DT Loan) E4 Global PLIF (Consignment)" into its parts.
 *
 * Driven by the brackets rather than by a separator, because the separator is
 * often not there. The team writes these by hand and a real one reads
 *
 *   Mariner (DT LOAN) E4 Global PLIF (Consignment)
 *
 * with nothing at all between the two systems. Splitting on "/" or "+" made
 * that one entry — so the booking offered a single row of buttons and could
 * not say that the Mariner is a distributor loan while the E4 cages are
 * consignment, which is the whole point of having the buttons per system.
 *
 * A bracketed supply closes a system. Whatever follows starts the next one.
 */
export function parseKitSupplies(kit) {
  const text = String(kit || '').trim()
  if (!text) return []

  const out = []
  // <anything that is not a bracket> ( <anything that is not a bracket> )
  const GROUP = /([^()[\]{}]+)[([{]([^)\]}]*)[)\]}]/g
  let last = 0
  for (const match of text.matchAll(GROUP)) {
    const name = match[1]
    const inside = match[2]
    const supply = matchSupply(inside)
    if (supply) {
      pushSystem(out, name)
      if (out.length) out[out.length - 1].supply = supply
    } else {
      // "(2 levels)", "(PM list)" — not a supply, so it belongs to the system
      // it is written against. The team put it there on purpose.
      pushSystem(out, `${name.trim()} (${inside})`)
    }
    last = match.index + match[0].length
  }

  // Anything after the final bracket, or the whole string when there were no
  // brackets at all: systems with no supply recorded yet.
  for (const name of text.slice(last).split(SPLIT)) pushSystem(out, name)
  return out
}

/** Adds a system, trimming the separators it may be wearing. */
function pushSystem(list, raw) {
  const name = String(raw || '').replace(/^[\s,/+&-]+|[\s,/+&-]+$/g, '').trim()
  if (!name) return
  // A separator in the middle means two systems sharing one supply bracket —
  // "Diplomat / Cascadia (Consignment)". Each gets its own row.
  const parts = name.split(SPLIT).map(p => p.trim()).filter(Boolean)
  for (const part of parts) list.push({ system: part, supply: null })
}

/** Writes the parts back out in the app's own convention. */
export function formatKitSupplies(entries) {
  return (entries || [])
    .filter(e => e && e.system)
    .map(e => (e.supply ? `${e.system} (${e.supply})` : e.system))
    .join(' / ')
}

/**
 * The supply named in a fragment, as one of the three, or null.
 *
 * Most specific first: "RHH Loan" contains "loan", so the general case has to
 * come last or it swallows both of the specific ones.
 */
export function matchSupply(text) {
  const said = String(text || '').trim()
  if (!said) return null
  if (/consign|^\s*cons\s*$/i.test(said)) return 'Consignment'
  if (/\brhh\b[\s-]*loan|loan[\s-]*(?:from[\s-]*)?\brhh\b/i.test(said)) return 'RHH Loan'
  // Ours, from the office. Checked before the distributors below and before
  // the bare "loan" at the bottom, both of which contain the same word.
  if (/\b(?:tm|technomed)\b[\s-]*loan|loan[\s-]*(?:from[\s-]*)?\b(?:tm|technomed)\b/i.test(said)) {
    return 'TM Loan'
  }
  // Named distributors count as distributor loans. The team writes "DT LOAN"
  // for Device Technologies and "SIGNUS LOAN" for Signus, and both mean the
  // same job: a request to send, and a delivery to chase. Reading them as a
  // bare "Loan" lost that.
  if (/distributor[\s-]*loan|loan[\s-]*(?:from[\s-]*)?distributor|\bdist\b/i.test(said)
    || /\b(?:dt|kt|e4|device|signus|seaspine|orthofix|globus|nuvasive)\b[\s-]*loan/i.test(said)
    || /loan[\s-]*(?:from[\s-]*)?\b(?:dt|kt|e4|device|signus|seaspine|orthofix|globus|nuvasive)\b/i.test(said)) {
    return 'Distributor Loan'
  }
  // A bare "Loan" from before there were three. Left as it is rather than
  // guessed into one of the two: a wrong answer here sends somebody to move a
  // tray that was never at RHH, or waits on a distributor who was never asked.
  if (/\bloan/i.test(said)) return 'Loan'
  return null
}

/**
 * Sets the supply for one system, leaving the others alone.
 *
 * Tapping the same answer twice clears it. There is no fourth button for "I do
 * not know", and somebody who taps the wrong one needs a way back that is not
 * retyping the field.
 */
export function setSupply(kit, system, supply) {
  const entries = parseKitSupplies(kit)
  const at = entries.findIndex(e =>
    e.system.toLowerCase() === String(system || '').toLowerCase())

  if (at < 0) {
    return formatKitSupplies([...entries, { system, supply }])
  }
  const next = entries.slice()
  next[at] = {
    ...next[at],
    supply: next[at].supply === supply ? null : supply
  }
  return formatKitSupplies(next)
}

/**
 * The systems on a booking that a supply can be set for.
 *
 * Taken from the kit field where there is one, because that is what the team
 * wrote, and from the system otherwise. Deduplicated case-insensitively: a
 * booking naming ASCOT in the title and Ascot in the kit is one system and
 * should get one row of buttons.
 *
 * Navigation is left out. "Spinal Brainlab" and "AIRO" turn up on a kit line
 * often — they were on Oakley's booking from Hana — and there is no answer to
 * give about them: the hospital owns the scanner, nobody requests one and
 * nobody drives one over. The kit text keeps them, because the AIRO badge is
 * read out of it; only the question goes away.
 */
export function systemsToSupply({ kit, system } = {}) {
  const fromKit = parseKitSupplies(kit).map(e => e.system)
  const fromSystem = fromKit.length ? [] : String(system || '').split(SPLIT)

  const seen = new Set()
  return [...fromKit, ...fromSystem]
    .map(s => String(s || '').trim())
    // Both sources, not just the kit field. A labelled booking puts the whole
    // kit line in `system` — Oakley's read "Mariner / Spinal Brainlab / AIRO"
    // there and nowhere else — so filtering one branch left the other asking
    // which distributor the scanner was coming from.
    .filter(s => !isNavigationOnly(s))
    .filter(s => {
      const key = s.toLowerCase()
      if (!s || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/**
 * Whether a case draws on the kit the hospital keeps on its shelf.
 *
 * "The app is still suggesting we borrow an RHH Mariner kit, even though we
 * have distributor loan kits booked for both cases on Friday."
 *
 * The shortfall check counted every case on the day that named a system and
 * compared the total against what is consigned at that hospital. Two Mariner
 * cases at Calvary, nothing consigned at Calvary, so: borrow one from RHH.
 * True of the stock, and wrong about the day — both cases had their own
 * distributor sets already requested and confirmed. The advice was to go and
 * fetch a tray that nobody needed.
 *
 * A case on loan brings its own kit. It does not touch the shelf, so it is not
 * competing for what is on it.
 *
 * A supply nobody has recorded yet counts as drawing on the shelf. That is the
 * safe direction: an unanswered case is one somebody still has to think about,
 * and a warning that stays up until it is answered is the point of the
 * warning. Silence would be the app quietly assuming a kit had been arranged.
 */
export function drawsOnLocalStock(kit, system) {
  const want = String(system || '').trim().toLowerCase()
  if (!want) return true

  const entry = parseKitSupplies(kit).find(e => {
    const named = e.system.toLowerCase()
    return named === want || named.includes(want) || want.includes(named)
  })
  if (!entry?.supply) return true

  // Every kind of loan arrives for the case: a distributor sends one, or we
  // bring one over ourselves. Either way it is not the hospital's.
  return !/loan/i.test(entry.supply)
}
