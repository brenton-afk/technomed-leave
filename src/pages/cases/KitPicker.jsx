import React, { useMemo, useState } from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'
import { SYSTEM_BUTTONS, variantOf, inventoryFor } from '../../clinicalPlan/inventory.js'
import { SUPPLY_OPTIONS, parseKitSupplies, formatKitSupplies } from '../../clinicalPlan/kitSupply.js'
import { suggestSystems, SYSTEM_GROUPS } from '../../clinicalPlan/systemSuggestions.js'
import { hospitalCode } from '../../clinicalPlan/labelledFields.js'

// ─── The kit, chosen by tapping ──────────────────────────────────────────────
// "I need to be able to tap the system with a button as opposed to writing it
// into the field." — Brent, 2 Nov 2026, changing an auto-added booking from
// Diplomat (Signus, consignment) to Mariner (Device Technologies, loan).
//
// Systems as buttons — tap to add, tap again to take off — and, for each one
// chosen, where it is coming from. Writes the kit line in the app's own
// convention ("Mariner (Distributor Loan) / Global BMD PLIF (Consignment)"),
// which is what the notices and loan requests read, so a change here is a
// change to who gets told.

const SYSTEMS = SYSTEM_BUTTONS
// The same system however it is written: "TM REMOVALS" on a booking is the
// TM Screw Removal button, so the button shows as on rather than offering a
// second copy.
//
// The same goes for any system written in the booking's own words: "E4 Global
// BMD PLIF cage" is the Global BMD PLIF button, not something unrecognised
// (Toni, 4 Nov 2026). Mariner MIS and Mariner Open are the exception — one
// item, two buttons — and are left to `toggle` below.
const same = (a, b) => {
  if (String(a).toLowerCase() === String(b).toLowerCase()) return true
  const x = inventoryFor(a), y = inventoryFor(b)
  if (!x || !y || x !== y) return false
  return x.tmKit || (!variantOf(a) && !variantOf(b) && !BUTTON_VARIANT_BASES.has(x.system))
}
const BUTTON_VARIANT_BASES = new Set(SYSTEM_BUTTONS.map(variantOf).filter(Boolean))

export default function KitPicker({ kit, onChange, systemsOnly = false, operation = '', surgeon = '', hospital = '' }) {
  const entries = parseKitSupplies(kit)
  const has = name => entries.some(e => same(e.system, name))

  // "There's still too many and it's too busy" — Brent, 4 Nov 2026. The
  // operation narrows the buttons to the systems that fit it (Brent's rules,
  // systemSuggestions.js), plus whatever the booking already has; everything
  // else is one tap away under "All systems". With no operation to go on, a
  // booking that already has its system shows just that, and the full set
  // only when nothing is chosen yet.
  const [showAll, setShowAll] = useState(false)
  const suggestion = useMemo(
    () => suggestSystems({ operation, surgeon, hospital: hospitalCode(hospital) || hospital }),
    [operation, surgeon, hospital])
  // A chosen Mariner keeps its other half in view, so MIS ↔ Open is one tap.
  const chosen = SYSTEMS.filter(name => has(name)
    || (variantOf(name) && SYSTEMS.some(o => o !== name && variantOf(o) === variantOf(name) && has(o))))
  const narrowed = suggestion.systems.length
    ? [...new Set([...suggestion.systems, ...suggestion.extras, ...chosen])]
    : chosen
  const shown = showAll || !narrowed.length ? SYSTEMS : SYSTEMS.filter(s => narrowed.includes(s))
  const hidden = SYSTEMS.length - shown.length
  const others = entries.filter(e => !e.navigation && !SYSTEMS.some(s => same(s, e.system)))

  // Mariner MIS and Mariner Open are the one Mariner, said precisely. Tapping
  // either takes over a plain "Mariner" already on the booking — keeping where
  // it is coming from — rather than sitting beside it as a second system
  // ("Why do we have Mariner and Mariner MIS? They are not two different
  // things.").
  const toggle = name => {
    if (has(name)) return onChange(formatKitSupplies(entries.filter(e => !same(e.system, name))))
    const base = variantOf(name)
    const plain = base && entries.find(e => same(e.system, base))
    if (plain) return onChange(formatKitSupplies(entries.map(e => (e === plain ? { system: name, supply: e.supply } : e))))
    return onChange(formatKitSupplies([...entries, { system: name, supply: null }]))
  }
  const supply = (name, option) => onChange(formatKitSupplies(entries.map(e =>
    (same(e.system, name) ? { ...e, supply: e.supply === option ? null : option } : e))))

  const chip = on => ({
    padding: '7px 11px', borderRadius: radius.pill, cursor: 'pointer',
    border: `1px solid ${on ? colour.accent : colour.line}`,
    background: on ? colour.accentSoft : colour.surface,
    ...text('caption'), fontWeight: on ? 700 : 400, color: on ? colour.accentDeep : colour.inkMuted
  })

  return (
    <div style={{ marginBottom: space.sm }}>
      <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: 4 }}>
        {suggestion.systems.length && !showAll
          ? `System — suggested for ${suggestion.groups.map(g => SYSTEM_GROUPS[g].label).join(' and ')}; tap to add or take off`
          : 'System — tap to add or take off'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: space.sm }}>
        {shown.map(name => (
          <button key={name} type="button" aria-pressed={has(name)} onClick={() => toggle(name)} style={chip(has(name))}>
            {name}
          </button>
        ))}
        {(hidden > 0 || showAll) && narrowed.length > 0 && (
          <button type="button" aria-expanded={showAll} onClick={() => setShowAll(v => !v)}
            style={{ ...chip(false), border: `1px dashed ${colour.line}`, color: colour.accentDeep, fontWeight: 700 }}>
            {showAll ? 'Fewer systems' : chosen.length && !suggestion.systems.length ? 'Change or add a system' : `All systems (${hidden} more)`}
          </button>
        )}
      </div>

      {others.length > 0 && (
        <div style={{ ...text('caption'), color: colour.inkMuted, marginBottom: space.sm }}>
          Also written: {others.map(e => e.system).join(', ')}
          {others.some(e => same(e.system, 'Mariner')) ? ' — tap Mariner MIS or Mariner Open above to say which' : ''}{' '}
          <button type="button" onClick={() => onChange(formatKitSupplies(entries.filter(e => e.navigation || SYSTEMS.some(s => same(s, e.system)))))}
            style={{ ...text('caption'), color: colour.danger, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            take off
          </button>
        </div>
      )}

      {!systemsOnly && entries.filter(e => SYSTEMS.some(s => same(s, e.system))).map(e => (
        <div key={e.system} style={{ marginBottom: space.sm }}>
          <div style={{ ...text('caption'), fontWeight: 700, color: colour.ink, marginBottom: 4 }}>{e.system} — coming from</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {SUPPLY_OPTIONS.map(option => (
              <button key={option} type="button" aria-pressed={e.supply === option}
                aria-label={`${e.system}: ${option}`} onClick={() => supply(e.system, option)}
                style={{ ...chip(e.supply === option), flexGrow: 1, flexBasis: '40%', borderRadius: radius.control, minHeight: 36 }}>
                {option}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
