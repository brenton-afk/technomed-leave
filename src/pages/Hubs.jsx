import React from 'react'
import { Page, Header, Body, NavCard, SectionLabel, Banner } from '../design/Shell.jsx'
import { colour, text, space } from '../design/tokens.js'
import {
  IconPlan, IconCalendar, IconKit, IconStock, IconFolder, IconTasks,
  IconClock, IconLeave, IconPayslip, IconLock, IconFile, IconLogout
} from '../design/icons.jsx'

// ─── Section hubs ─────────────────────────────────────────────────────────────
// A hub is a list of cards, deliberately not a second tab bar. A tab bar inside
// a tab gives you two competing "where am I" signals, which is most of what
// makes an app feel cluttered.

export function CasesHub({ user, onNavigate }) {
  return (
    <Page>
      <Header eyebrow="Case support" title="Cases" subtitle="The plan, the kit, and everything you need before a list" />
      <Body>
        <SectionLabel style={{ marginTop: 0 }}>This week</SectionLabel>
        <NavCard icon={IconPlan} label="Clinical plan" tone="accent"
          detail="Weekly and daily views, exportable"
          onClick={() => onNavigate({ tab: 'cases', sub: 'plan' })} />
        <NavCard icon={IconCalendar} label="Calendar"
          detail="Bookings and leave, week by week"
          onClick={() => onNavigate({ tab: 'cases', sub: 'calendar' })} />

        <SectionLabel>Kit and stock</SectionLabel>
        <NavCard icon={IconKit} label="Kit Room"
          detail="What's where, across both hospitals"
          onClick={() => onNavigate({ tab: 'cases', sub: 'kit' })} />
        <NavCard icon={IconStock} label="Stock take"
          detail="Not set up yet"
          onClick={() => onNavigate({ tab: 'cases', sub: 'stock' })} />

        <SectionLabel>Reference</SectionLabel>
        <NavCard icon={IconFolder} label="Resources"
          detail="Surgical templates, techniques, implant codes"
          onClick={() => onNavigate({ tab: 'cases', sub: 'resources' })} />

        <SectionLabel>Team</SectionLabel>
        <NavCard icon={IconTasks} label="Projects & actions"
          detail="Meeting notes and the shared worklist"
          onClick={() => onNavigate({ tab: 'cases', sub: 'projects' })} />
      </Body>
    </Page>
  )
}

export function MeHub({ user, onNavigate, onLogout }) {
  const hasTimesheets = user?.staff?.hasTimesheets === true

  return (
    <Page>
      <Header
        eyebrow={user?.staff?.role || 'Staff'}
        title={user?.name || 'You'}
        subtitle={user?.email}
      />
      <Body>
        <SectionLabel style={{ marginTop: 0 }}>Pay and time</SectionLabel>
        <NavCard icon={IconClock} label="Timesheets" tone="accent"
          detail={hasTimesheets ? 'Fortnightly hours for payroll' : 'Not required for your role'}
          disabled={!hasTimesheets}
          onClick={() => onNavigate({ tab: 'me', sub: 'timesheets' })} />
        <NavCard icon={IconLeave} label="Leave"
          detail="Apply for annual, personal or TOIL"
          onClick={() => onNavigate({ tab: 'me', sub: 'leave' })} />
        <NavCard icon={IconPayslip} label="Payslips"
          detail="Not set up yet"
          onClick={() => onNavigate({ tab: 'me', sub: 'payslips' })} />

        <SectionLabel>Your files</SectionLabel>
        <NavCard icon={IconFile} label="Filed usage sheets"
          detail="Everything saved to Dropbox from a scan"
          onClick={() => onNavigate({ tab: 'me', sub: 'usagefiles' })} />

        <SectionLabel>Account</SectionLabel>
        <NavCard icon={IconLock} label="Sign-in & Face ID"
          detail="Manage this device"
          onClick={() => onNavigate({ tab: 'me', sub: 'security' })} />
        <NavCard icon={IconLogout} label="Log out"
          detail={user?.email}
          onClick={onLogout} />
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
