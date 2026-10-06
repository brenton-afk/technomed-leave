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
//   RHH Loan         we move it ourselves, from RHH. A job for our team, on a
//                    particular morning, and the thing most likely to be
//                    forgotten because it does not involve anybody outside.
//   Distributor Loan somebody has to request it and chase it. A lead time, and
//                    a phone call if it has not arrived.
//
// They used to be two — "Loan" covered the last two — which hid exactly the
// distinction that decides whether a tray turns up.
//
// Per system, because one case is often two systems with different answers,
// which is the whole reason the field could not just be a single choice.

/** The three, in the order they appear on the buttons. */
export const SUPPLY_OPTIONS = ['Consignment', 'RHH Loan', 'Distributor Loan']

const SPLIT = /\s*[/,]\s*|\s+\+\s+/

/** Reads "Ascot (Consignment) / Athlet (RHH Loan)" into its parts. */
export function parseKitSupplies(kit) {
  const text = String(kit || '').trim()
  if (!text) return []

  return text.split(SPLIT).map(part => {
    const piece = part.trim()
    if (!piece) return null
    const bracket = /^(.*?)\s*[([{]([^)\]}]*)[)\]}]\s*$/.exec(piece)
    if (!bracket) return { system: piece, supply: null }
    const supply = matchSupply(bracket[2])
    return {
      system: bracket[1].trim() || piece,
      // Something else in the brackets — "(2 levels)", "(PM list)" — is not a
      // supply and is left attached to the system, because the team put it
      // there on purpose and dropping it loses what they meant.
      supply,
      ...(supply ? {} : { system: piece })
    }
  }).filter(Boolean)
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
  if (/distributor[\s-]*loan|loan[\s-]*(?:from[\s-]*)?distributor|\bdist\b/i.test(said)) {
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
 */
export function systemsToSupply({ kit, system } = {}) {
  const fromKit = parseKitSupplies(kit).map(e => e.system)
  const fromSystem = fromKit.length ? [] : String(system || '').split(SPLIT)

  const seen = new Set()
  return [...fromKit, ...fromSystem]
    .map(s => String(s || '').trim())
    .filter(s => {
      const key = s.toLowerCase()
      if (!s || seen.has(key)) return false
      seen.add(key)
      return true
    })
}
