import React, { useMemo, useState, useEffect } from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'
import { IconCopy, IconShare } from '../../design/icons.jsx'
import { caseSummaryLines, caseSummaryText, caseSummaryTitle, copyText, shareText } from '../../clinicalPlan/caseSummary.js'

// ─── The case at a glance, ready to paste ────────────────────────────────────
// Toni, 4 Nov 2026: "for ease of copy/pasting case details when required to
// email / chat … I find the full view in the 'edit booking' window clunky to
// look at." Sits at the top of the booking, built from the fields as they
// stand, so an edit below it changes it straight away — the same text the Copy
// button on the week gives, from caseSummary.js.

export default function CaseSummary({ booking }) {
  const lines = useMemo(() => caseSummaryLines(booking), [booking])
  const [said, setSaid] = useState('')
  useEffect(() => {
    if (!said) return undefined
    const t = setTimeout(() => setSaid(''), 2500)
    return () => clearTimeout(t)
  }, [said])

  if (!lines.length) return null

  async function copy() {
    setSaid((await copyText(caseSummaryText(booking))) ? 'Copied — paste it into an email or chat' : 'Could not copy on this phone')
  }
  async function share() {
    const result = await shareText(caseSummaryTitle(booking), caseSummaryText(booking))
    if (result === 'copied') setSaid('Copied — paste it into an email or chat')
    if (result === 'failed') setSaid('Could not share on this phone')
  }

  return (
    <section aria-label="Case summary" style={{
      background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.control,
      padding: space.md, marginBottom: space.md
    }}>
      <div style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, marginBottom: space.sm }}>
        Case summary
      </div>
      <dl style={{
        display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: space.md, rowGap: 4,
        margin: 0, userSelect: 'text', WebkitUserSelect: 'text'
      }}>
        {lines.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt style={{ ...text('caption'), color: colour.inkFaint }}>{label}</dt>
            <dd style={{ ...text('bodyStrong'), color: colour.ink, margin: 0, overflowWrap: 'anywhere' }}>{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      <div style={{ display: 'flex', gap: space.sm, marginTop: space.md }}>
        <button type="button" onClick={copy} style={action(true)}>
          <IconCopy size={18} /> Copy
        </button>
        <button type="button" onClick={share} style={action(false)}>
          <IconShare size={18} /> Share
        </button>
      </div>
      {said && (
        <div role="status" style={{ ...text('caption'), color: colour.accentDeep, marginTop: space.sm }}>{said}</div>
      )}
    </section>
  )
}

const action = primary => ({
  flex: 1, minHeight: 44, cursor: 'pointer', borderRadius: radius.control,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  ...text('bodyStrong'),
  border: `1px solid ${colour.accent}`,
  background: primary ? colour.accent : colour.surface,
  color: primary ? 'white' : colour.accentDeep
})
