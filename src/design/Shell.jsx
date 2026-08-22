import React from 'react'
import { colour, text, space, radius, border, font, card } from './tokens.js'
import { IconChevron, IconBack } from './icons.jsx'

// ─── Layout primitives ────────────────────────────────────────────────────────
// Hubs and sub-views are built from these, so a new screen inherits the right
// spacing and type without re-deciding either. Section pages are lists of cards
// on purpose: a second tab bar inside a tab is what makes an app feel clunky.

/** The dark page header. `onBack` turns it into a sub-view header. */
export function Header({ eyebrow, title, subtitle, onBack, right, children }) {
  return (
    <div style={{
      background: colour.navy,
      padding: `calc(${space.xl}px + env(safe-area-inset-top, 34px)) ${space.lg}px ${space.lg}px`
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: space.md }}>
        {onBack && (
          <button onClick={onBack} aria-label="Back"
            style={{
              width: 34, height: 34, marginTop: 2, flexShrink: 0,
              borderRadius: radius.pill, border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.08)', color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
            }}>
            <IconBack size={18} />
          </button>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          {eyebrow && (
            <div style={{ ...text('micro'), color: 'rgba(255,255,255,0.42)', textTransform: 'uppercase', marginBottom: 5 }}>
              {eyebrow}
            </div>
          )}
          <h1 style={{ ...text('display'), color: 'white', margin: 0 }}>{title}</h1>
          {subtitle && (
            <div style={{ ...text('caption'), color: 'rgba(255,255,255,0.55)', marginTop: 5 }}>{subtitle}</div>
          )}
        </div>
        {right}
      </div>
      {children && <div style={{ marginTop: space.lg }}>{children}</div>}
    </div>
  )
}

export function Page({ children, style }) {
  return (
    <div style={{ minHeight: '100vh', background: colour.canvas, fontFamily: font, ...style }}>
      {children}
    </div>
  )
}

export function Body({ children, style }) {
  return <div style={{ padding: space.lg, ...style }}>{children}</div>
}

/** Small uppercase label that separates groups of cards. */
export function SectionLabel({ children, style }) {
  return (
    <div style={{
      ...text('micro'), color: colour.inkFaint, textTransform: 'uppercase',
      margin: `${space.xl}px 0 ${space.sm}px`, ...style
    }}>
      {children}
    </div>
  )
}

/**
 * The building block of every hub: an icon, a label, a line of context, and a
 * chevron. Large enough to hit reliably in a corridor.
 */
export function NavCard({ icon: Icon, label, detail, badge, onClick, disabled, tone = 'default' }) {
  const tinted = tone === 'accent'
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled}
      style={{
        ...card(),
        width: '100%', display: 'flex', alignItems: 'center', gap: space.md,
        padding: `${space.md + 2}px ${space.md}px`, marginBottom: space.sm,
        textAlign: 'left', cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1, font: 'inherit'
      }}>
      <span style={{
        width: 38, height: 38, borderRadius: radius.control, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: tinted ? colour.accentSoft : colour.canvas,
        color: tinted ? colour.accent : colour.navy
      }}>
        <Icon size={20} />
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ ...text('bodyStrong'), color: colour.ink, display: 'block' }}>{label}</span>
        {detail && (
          <span style={{ ...text('caption'), color: colour.inkFaint, display: 'block', marginTop: 1 }}>{detail}</span>
        )}
      </span>
      {badge != null && badge !== 0 && (
        <span style={{
          ...text('micro'), background: colour.accent, color: 'white',
          borderRadius: radius.pill, padding: '3px 8px', flexShrink: 0
        }}>
          {badge}
        </span>
      )}
      <span style={{ color: colour.inkFainter, flexShrink: 0, display: 'flex' }}><IconChevron size={18} /></span>
    </button>
  )
}

/** A plain content card, for anything that isn't navigation. */
export function Card({ children, style, onClick }) {
  const interactive = Boolean(onClick)
  return (
    <div onClick={onClick} role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
      style={{
        ...card(), padding: space.md + 2, marginBottom: space.sm,
        cursor: interactive ? 'pointer' : 'default', ...style
      }}>
      {children}
    </div>
  )
}

export function Banner({ tone = 'info', children, action }) {
  const tones = {
    info: { bg: colour.accentSoft, fg: colour.accentDeep, line: 'rgba(24,154,133,0.28)' },
    warning: { bg: colour.warningSoft, fg: colour.warning, line: colour.warningLine },
    danger: { bg: colour.dangerSoft, fg: colour.danger, line: colour.dangerLine }
  }
  const t = tones[tone] || tones.info
  return (
    <div style={{
      background: t.bg, border: `1px solid ${t.line}`, color: t.fg,
      borderRadius: radius.control, padding: `${space.md}px ${space.md}px`,
      marginBottom: space.md, ...text('caption')
    }}>
      {children}
      {action && <div style={{ marginTop: space.sm }}>{action}</div>}
    </div>
  )
}

export function Button({ children, onClick, variant = 'primary', disabled, style }) {
  const variants = {
    primary: { background: colour.accent, color: 'white', border: 'none' },
    secondary: { background: colour.surface, color: colour.navy, border: border.hairline },
    quiet: { background: 'transparent', color: colour.inkFaint, border: border.hairline },
    danger: { background: colour.dangerSoft, color: colour.danger, border: `1px solid ${colour.dangerLine}` }
  }
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        ...variants[variant], ...text('bodyStrong'),
        width: '100%', padding: `${space.md + 1}px ${space.lg}px`,
        borderRadius: radius.control, cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1, font: 'inherit', ...style
      }}>
      {children}
    </button>
  )
}

export function EmptyState({ icon: Icon, title, detail, action }) {
  return (
    <div style={{ ...card(), padding: `${space.xxxl}px ${space.xl}px`, textAlign: 'center' }}>
      {Icon && (
        <span style={{ color: colour.inkFainter, display: 'inline-flex', marginBottom: space.md }}>
          <Icon size={30} />
        </span>
      )}
      <div style={{ ...text('heading'), color: colour.ink, marginBottom: 4 }}>{title}</div>
      {detail && <div style={{ ...text('caption'), color: colour.inkFaint, lineHeight: 1.6 }}>{detail}</div>}
      {action && <div style={{ marginTop: space.lg }}>{action}</div>}
    </div>
  )
}

/** Skeleton line, for loading states that mirror the layout beneath them. */
export function Skeleton({ width = '100%', height = 12, style }) {
  return (
    <div style={{
      width, height, borderRadius: 5, background: colour.lineSoft,
      marginBottom: space.sm, ...style
    }} />
  )
}
