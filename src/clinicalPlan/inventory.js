import { zonedCivil, zonedToInstant, addCivilDays, civilWeekday, toDateStr, TZ } from './week.js'

// ─── What is already where ───────────────────────────────────────────────────
// Which instrument sets sit at which hospital, and therefore which bookings need
// a loan set ordered and which do not.
//
// Dictated by Brent, 23 September 2026. This is knowledge that lives in people's
// heads and nowhere else — it is what lets the app say "Reform at Calvary needs
// a loan kit" instead of asking someone to remember. It also goes stale: a set
// gets consigned, a floating kit is reassigned. **Check it against reality
// before trusting a quiet week**, and update it here when it moves.
//
// `consigned` is sets that live at that hospital permanently. `floating` is a
// TechnoMed-owned loan kit that moves between sites — it covers a case without a
// distributor request, but it can only be in one place at a time, which is
// exactly the clash worth surfacing.

export const HOSPITALS = { RHH: 'RHH', CLV: 'CLV' }

export const INVENTORY = [
  // ── Signus ──
  {
    system: 'Diplomat', distributor: 'signus',
    consigned: { CLV: 3, RHH: 1 }
  },
  {
    system: 'Athlet', distributor: 'signus',
    consigned: { RHH: 1 },
    // The instrument kit lives at RHH because that is the public hospital taking
    // most of the trauma; sterile implants are held at both and the kit travels.
    note: 'Instrument kit at RHH, moved between sites. Sterile implants at both.',
    movesBetweenSites: true
  },
  {
    system: 'Ascot', distributor: 'signus',
    consigned: { CLV: 1, RHH: 1 },
    note: 'Plating.'
  },
  {
    system: 'CYLOX', distributor: 'signus',
    consigned: {},
    loanSets: 2,
    note: 'Two loan sets. Close to being consigned to Calvary, but not yet — '
      + 'so a CYLOX case still needs a set organised.'
  },
  {
    system: 'MOBIS', distributor: 'signus',
    consigned: { CLV: 1 },
    note: 'Includes sterile implants.'
  },

  // ── Device Technologies (SeaSpine) ──
  {
    system: 'Mariner', distributor: 'device',
    consigned: { RHH: 1 },
    note: 'Calvary has none — a Mariner case there needs a loan set.'
  },
  {
    system: 'Shoreline', distributor: 'device',
    consigned: { CLV: 2, RHH: 1 },
    floating: 1
  },
  {
    system: 'Mariner Outrigger', distributor: 'device',
    consigned: {},
    floating: 1,
    note: 'Connector set. TechnoMed floating kit, mostly lives at Calvary.'
  },

  // ── E4 Surgical ──
  {
    system: 'Global BMD PLIF', distributor: 'e4',
    consigned: { CLV: 2 },
    floating: 1,
    note: 'Floating kit mostly lives at RHH. Sterile implants at both sites, '
      + 'though most of them are at Calvary.'
  },
  {
    system: 'Global BMD ALIF', distributor: 'e4',
    consigned: { CLV: 1 },
    note: 'Calvary only, with sterile implants.'
  },
  {
    system: 'Dakota', distributor: 'e4',
    consigned: { CLV: 1, RHH: 1 },
    floating: 1
  },
  {
    system: 'Reform Cervical', distributor: 'e4',
    consigned: { RHH: 1 },
    note: 'POCT. RHH only — a Calvary case has to have a loan kit requested.'
  },

  // ── KT Medical ──
  // Theirs, not ours. We use the RHH sets for the cases we cover there; the
  // Calvary sets are for cases KT cover themselves, and we only attend when
  // they ask.
  {
    system: 'Lonestar', distributor: 'kt',
    consigned: { RHH: 1, CLV: 2 },
    ours: false,
    weCover: { RHH: true, CLV: false },
    note: 'KT Medical\'s sets. We cover the RHH cases; KT cover Calvary unless '
      + 'they explicitly ask us to assist.'
  },
  {
    system: 'Orthofix Firebird', distributor: 'kt',
    consigned: { RHH: 1, CLV: 1 },
    ours: false,
    weCover: { RHH: true, CLV: false },
    note: 'Pedicle screws. Used with Forza XP for Peters-Willke cases — we help '
      + 'at RHH, mostly not at Calvary.'
  },
  {
    system: 'Forza XP', distributor: 'kt',
    consigned: { RHH: 1, CLV: 1 },
    ours: false,
    weCover: { RHH: true, CLV: false }
  },

  // ── Not ours at all ──
  {
    system: 'Cascadia', distributor: null,
    consigned: {},
    ours: false,
    competitor: 'Life Health Care (K2M)',
    note: 'A competitor\'s cage. We attend these cases for the Diplomat; the '
      + 'cages themselves are supported by Life Health Care.'
  }
]

const byName = new Map(INVENTORY.map(item => [item.system.toLowerCase(), item]))

/** What the app knows about a system, by name. */
export function inventoryFor(system) {
  const name = String(system || '').trim().toLowerCase()
  if (!name) return null
  if (byName.has(name)) return byName.get(name)
  // Longest match first, so "Global BMD PLIF" is not answered by a shorter entry.
  const hit = INVENTORY
    .slice()
    .sort((a, b) => b.system.length - a.system.length)
    .find(item => new RegExp(`\\b${item.system.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(name))
  return hit || null
}

/**
 * Whether a case needs a set organised, and why.
 *
 * Deliberately says "ask" rather than "no" when it does not know. A wrong "no
 * loan needed" is a case with no instruments on the day, which is the worst
 * outcome this whole feature exists to prevent.
 */
export function loanNeed(system, hospital) {
  const item = inventoryFor(system)
  // Both the code and the name, because bookings carry either: "CLV",
  // "Calvary", "Calvary Lenah Valley", "RHH", "Royal Hobart".
  const text = String(hospital || '').toUpperCase()
  const site = /\bCLV\b|CALVARY|LENAH/.test(text) ? 'CLV'
    : /\bRHH\b|ROYAL\s*HOBART/.test(text) ? 'RHH' : null

  if (!item) return { need: 'unknown', reason: 'System not in the inventory — check before assuming.' }
  if (item.competitor) {
    return { need: 'none', reason: `${item.system} is ${item.competitor}'s — not ours to supply.`, item }
  }
  if (!site) return { need: 'unknown', reason: 'Hospital not recognised.', item }

  if (item.ours === false && item.weCover && !item.weCover[site]) {
    return {
      need: 'none',
      reason: `${item.system} at ${site} is covered by ${item.distributor === 'kt' ? 'KT Medical' : 'the supplier'}, not us.`,
      item
    }
  }

  const consigned = item.consigned?.[site] || 0
  if (consigned > 0) {
    return { need: 'none', reason: `${consigned} consigned at ${site}.`, item }
  }
  if (item.movesBetweenSites) {
    return { need: 'move', reason: `The ${item.system} kit moves between sites — check where it is.`, item }
  }
  if (item.floating) {
    return { need: 'move', reason: `Covered by the floating TechnoMed kit — check it is free.`, item }
  }
  return {
    need: 'order',
    reason: `Nothing consigned at ${site}. A loan set has to be requested.`,
    item
  }
}


/**
 * When a loan kit has to be at the hospital.
 *
 * The stated rule is 48 hours before surgery, and the two worked examples are
 * "Thursday surgery, kit Tuesday morning" and "Monday surgery, kit no later than
 * Friday 9am". Those look inconsistent until the weekend is accounted for:
 *
 *   Thursday 08:00 − 48h = Tuesday 08:00     → Tuesday morning ✓
 *   Monday   08:00 − 48h = Saturday 08:00    → nobody receives on a Saturday,
 *                                              so it is pulled back to Friday ✓
 *
 * So: 48 hours before, and if that lands on a weekend, the last working day
 * before it at 09:00. Hospitals appreciate the two clear days; the deadline is
 * what goes in the request so the distributor is told the date rather than left
 * to work it out.
 */
export function kitArrivalBy(surgeryIso, tz = TZ) {
  if (!surgeryIso) return null
  const at = new Date(surgeryIso)
  if (Number.isNaN(at.getTime())) return null

  let civil = zonedCivil(new Date(at.getTime() - 48 * 60 * 60 * 1000), tz)
  let weekday = civilWeekday(civil)          // 1 = Monday … 7 = Sunday

  if (weekday >= 6) {
    // Back to the Friday, and at 9am rather than whatever hour the surgery is:
    // a Friday delivery has to arrive within the working day.
    civil = addCivilDays(civil, weekday === 6 ? -1 : -2)
    civil = { ...civil, hour: 9, minute: 0 }
  }

  return {
    date: toDateStr(civil),
    time: `${String(civil.hour ?? 9).padStart(2, '0')}:${String(civil.minute ?? 0).padStart(2, '0')}`,
    iso: zonedToInstant({ ...civil, hour: civil.hour ?? 9, minute: civil.minute ?? 0 }, tz).toISOString(),
    // True when the 48 hours could not be honoured because the booking arrived
    // too late — the request then says "as soon as possible" and somebody rings.
    rushed: false
  }
}

/** Whether there is still time to hit that deadline, given when we are now. */
export function isRush(surgeryIso, now = new Date(), tz = TZ) {
  const by = kitArrivalBy(surgeryIso, tz)
  if (!by) return false
  return new Date(by.iso).getTime() <= now.getTime()
}
