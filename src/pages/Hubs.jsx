import React from 'react'
import { Page, Header, Body, NavCard, NavGroup, IconTile, SectionLabel, Banner } from '../design/Shell.jsx'
import { STAFF } from '../staffConfig.js'
import { colour, text, space, radius, border } from '../design/tokens.js'
import {
  IconKit, IconStock, IconFolder, IconTasks,
  IconClock, IconLeave, IconPayslip, IconLock, IconFile, IconLogout, IconAdmin, IconChart, IconChat
} from '../design/icons.jsx'

// ─── Section hubs ─────────────────────────────────────────────────────────────
// A hub is a list of cards, deliberately not a second tab bar. A tab bar inside
// a tab gives you two competing "where am I" signals, which is most of what
// makes an app feel cluttered.

export function KitHub({ user, onNavigate }) {
  // Kit is only kit (Brent, 12 Nov 2026): Projects, Resources and Team leader
  // moved to their own homes — their own tabs, and Cases.
  return (
    <Page>
      <Header eyebrow="Kit" title="Kit" subtitle="What's where, and what to bring" />
      <Body>
        <NavGroup first>
          <NavCard icon={IconKit} label="Kit Room" tint="teal"
            detail="What's where, across both hospitals"
            onClick={() => onNavigate({ tab: 'kit', sub: 'kitroom' })} />
          <NavCard icon={IconStock} label="Stock take" tint="amber"
            detail="Not set up yet"
            onClick={() => onNavigate({ tab: 'kit', sub: 'stock' })} />
          <NavCard icon={IconFolder} label="Theatre guides" tint="ocean"
            detail="Field references and surgeon preference cards"
            onClick={() => onNavigate({ tab: 'kit', sub: 'guides' })} />
        </NavGroup>
      </Body>
    </Page>
  )
}

// ─── Me (face lift, Brent 12 Nov 2026: "I don't like the blue band at the top
// with all the buttons … build some style into the whole portal, like we did
// with the front cases page") ────────────────────────────────────────────────
// The band carries who you are — your initials, name and role over the logo's
// tiles. The three things people open most sit under it as tiles; the rest is
// grouped into settings-style lists instead of a stack of separate boxes.

const initialsOf = name => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '·'

function Avatar({ name }) {
  return (
    <span aria-hidden="true" style={{
      width: 56, height: 56, borderRadius: radius.pill, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(145deg, #22b39b 0%, #0f7566 100%)', color: 'white', ...text('title'),
      boxShadow: '0 0 0 3px rgba(255,255,255,0.16), 0 4px 14px rgba(0,0,0,0.3)'
    }}>{initialsOf(name)}</span>
  )
}

function QuickTile({ icon, tint, label, badge, onClick }) {
  return (
    <button type="button" onClick={onClick} data-quick-tile={label} style={{
      position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: space.sm,
      padding: space.md, background: colour.surface, border: border.hairline, borderRadius: radius.card,
      boxShadow: '0 1px 2px rgba(4,39,70,0.04), 0 4px 14px rgba(4,39,70,0.05)', textAlign: 'left', minWidth: 0
    }}>
      <IconTile icon={icon} tint={tint} size={40} />
      <span style={{ ...text('bodyStrong'), color: colour.ink }}>{label}</span>
      {badge > 0 && (
        <span style={{ ...text('micro'), position: 'absolute', top: 10, right: 10, background: colour.danger, color: 'white', borderRadius: radius.pill, padding: '3px 8px' }}>
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  )
}

export function MeHub({ user, onNavigate, onLogout, treasury = false, unread = 0 }) {
  const hasTimesheets = user?.staff?.hasTimesheets === true
  const me = STAFF.find(s => s.email === user?.email)
  const role = [user?.staff?.role || me?.role, me?.division].filter(Boolean).join(' · ') || 'Staff'
  const go = target => () => onNavigate(target)

  // The three most opened, as tiles: Messages and Leave for everyone, then
  // Timesheets for those who file one, else Admin for an admin, else history.
  const third = hasTimesheets
    ? { icon: IconClock, tint: 'ocean', label: 'Timesheets', to: { tab: 'me', sub: 'timesheets' } }
    : user?.isAdmin
      ? { icon: IconAdmin, tint: 'navy', label: 'Admin', to: { tab: 'admin', sub: null } }
      : { icon: IconFile, tint: 'slate', label: 'Patient history', to: { tab: 'me', sub: 'patient' } }

  return (
    <Page>
      <Header lead={<Avatar name={user?.name} />} eyebrow={role} title={user?.name || 'You'} subtitle={user?.email} />
      <Body>
        <div data-quick-tiles style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: space.sm, marginBottom: space.lg, maxWidth: 560 }}>
          {/* Messages, until it has its own app (Brent, 12 Nov 2026). */}
          <QuickTile icon={IconChat} tint="teal" label="Messages" badge={unread} onClick={go({ tab: 'me', sub: 'messages' })} />
          <QuickTile icon={IconLeave} tint="grape" label="Leave" onClick={go({ tab: 'me', sub: 'leave' })} />
          <QuickTile icon={third.icon} tint={third.tint} label={third.label} onClick={go(third.to)} />
        </div>

        {(user?.isAdmin || treasury) && (
          <NavGroup label="Administration" first>
            {user?.isAdmin && (
              <NavCard icon={IconAdmin} label="Admin portal" tint="navy"
                detail="Staff, PINs, approvals and system status" onClick={go({ tab: 'admin', sub: null })} />
            )}
            {/* Only when the server has said this person may see it. */}
            {treasury && (
              <NavCard icon={IconChart} label="Treasury" tint="amber"
                detail="Private · cash, ATO, Bitcoin and the trust" onClick={go({ tab: 'me', sub: 'treasury' })} />
            )}
          </NavGroup>
        )}

        <NavGroup label="Pay and time" first={!user?.isAdmin && !treasury}>
          {/* Only for the people who file one (Brent, 12 Nov 2026). */}
          {hasTimesheets && (
            <NavCard icon={IconClock} label="Timesheets" tint="ocean"
              detail="Fortnightly hours for payroll" onClick={go({ tab: 'me', sub: 'timesheets' })} />
          )}
          <NavCard icon={IconLeave} label="Leave" tint="grape"
            detail="Apply for annual, personal or TOIL" onClick={go({ tab: 'me', sub: 'leave' })} />
          <NavCard icon={IconPayslip} label="Payslips" tint="slate"
            detail="Not set up yet" onClick={go({ tab: 'me', sub: 'payslips' })} />
        </NavGroup>

        <NavGroup label="Your files">
          <NavCard icon={IconFile} label="Patient history" tint="sky"
            detail="Every case filed under a surname, whichever surgeon" onClick={go({ tab: 'me', sub: 'patient' })} />
          <NavCard icon={IconFile} label="Filed usage sheets" tint="ocean"
            detail="Everything saved to Dropbox from a scan" onClick={go({ tab: 'me', sub: 'usagefiles' })} />
        </NavGroup>

        <NavGroup label="Account">
          <NavCard icon={IconLock} label="Notifications" tint="slate"
            detail="Messages on your phone, on or off" onClick={go({ tab: 'me', sub: 'notifications' })} />
          <NavCard icon={IconLock} label="Sign-in & Face ID" tint="navy"
            detail="Manage this device" onClick={go({ tab: 'me', sub: 'security' })} />
          <NavCard icon={IconLogout} label="Log out" tint="rose"
            detail={user?.email} onClick={onLogout} />
        </NavGroup>

        {/* Which version this phone is running; tapping reloads past any saved copy. */}
        <button type="button" onClick={() => { window.location.href = `/?r=${Date.now()}` }}
          style={{ display: 'block', width: '100%', marginTop: space.lg, background: 'none', border: 'none',
            cursor: 'pointer', textAlign: 'center', ...text('micro'), color: colour.inkFaint }}>
          Version {typeof __APP_COMMIT__ === 'undefined' ? 'dev' : __APP_COMMIT__}
          {typeof __APP_BUILT_AT__ === 'undefined' ? '' : ` · ${new Date(__APP_BUILT_AT__).toLocaleString('en-AU', {
            day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Hobart' })}`}
          {' · tap to refresh'}
        </button>
      </Body>
    </Page>
  )
}

/** A section that exists structurally but has nothing behind it yet. */
export function ComingSoonSection({ title, eyebrow, detail, icon: Icon, onBack }) {
  return (
    <Page>
      <Header eyebrow={eyebrow} title={title} onBack={onBack} />
      <Body>
        <div style={{ textAlign: 'center', padding: `${space.xxxl}px ${space.xl}px` }}>
          {Icon && (
            <span style={{ color: colour.inkFainter, display: 'inline-flex', marginBottom: space.md }}>
              <Icon size={34} />
            </span>
          )}
          <div style={{ ...text('heading'), color: colour.ink, marginBottom: 6 }}>Not set up yet</div>
          <div style={{ ...text('caption'), color: colour.inkFaint, lineHeight: 1.65, maxWidth: 320, margin: '0 auto' }}>
            {detail}
          </div>
        </div>
      </Body>
    </Page>
  )
}
