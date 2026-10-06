import React from 'react'
import { Page, Header, Body, Card, Banner, SectionLabel } from '../design/Shell.jsx'
import { colour, text, space, radius } from '../design/tokens.js'
import { usePush, installHint, installed, pushPossible, platform } from '../push.js'

// ─── Notifications, in settings, where somebody would look for them ──────────
// The switch existed and lived inside the chat, as a banner that appeared when
// the state happened to warrant one. So the only way to find it was to open
// Messages and hope — and the only way to know whether notifications were on
// was to notice you had stopped getting any.
//
// Settings is where somebody looks for a setting. This says what the state is
// in a sentence, offers the one action that changes it, and where the answer
// is "your phone cannot do this yet" it says what to do about that instead of
// stopping at "unsupported".

const SAID = {
  on: {
    tone: 'ok',
    title: 'Notifications are on',
    detail: 'Messages in the team channels reach this device, and tapping one '
      + 'opens it. Patient identifiers never appear — the channels refuse to '
      + 'carry them, so nothing on a lock screen is anything the team did not '
      + 'already agree was safe to write down.',
    action: 'Turn them off'
  },
  off: {
    tone: 'info',
    title: 'Notifications are off',
    detail: 'Turn them on and this works like the WhatsApp group — a message '
      + 'here reaches everyone’s phone instead of waiting until somebody '
      + 'thinks to look.',
    action: 'Turn on notifications'
  },
  blocked: {
    tone: 'warning',
    title: 'Notifications are blocked',
    detail: 'The app asked once and was refused, and a refusal cannot be asked '
      + 'again from inside the app. Find TechnoMed in your phone’s Settings and '
      + 'allow notifications there, then come back.',
    action: null
  }
}

export default function Notifications({ user, onBack }) {
  const { state, busy, toggle } = usePush(user?.token)
  const here = platform()

  // Two states that are not really about notifications at all — they are about
  // where the app is running — and both have a next step, so neither is
  // allowed to say "unsupported" and stop.
  const needsInstalling = state === 'not-installed'
    || (state === 'unsupported' && !installed())

  const said = SAID[state]

  return (
    <Page>
      <Header
        eyebrow="Account"
        title="Notifications"
        subtitle="Messages from the team channels, on this device"
        onBack={onBack} />

      <Body>
        {needsInstalling ? (
          <>
            <Banner tone="info">
              {installed()
                ? 'This browser cannot show notifications.'
                : 'Notifications need the app installed, not a browser tab or a shortcut.'}
            </Banner>

            <Card style={{ marginTop: space.md }}>
              <div style={{ ...text('bodyStrong'), color: colour.ink, marginBottom: space.xs }}>
                {here === 'ios' ? 'On an iPhone or iPad' : here === 'android' ? 'On Android' : 'To install'}
              </div>
              <div style={{ ...text('body'), color: colour.inkMuted, lineHeight: 1.6 }}>
                {installHint(here)}
              </div>
              {/* The part people get wrong, and the reason an installed-looking
                  icon can still have no notifications: the shortcut and the
                  app look identical on a home screen. */}
              {here === 'android' && (
                <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: space.sm, lineHeight: 1.6 }}>
                  A shortcut and the installed app look the same on your home
                  screen. If notifications still cannot be turned on after
                  adding it, it is a shortcut — remove it and use “Install app”.
                </div>
              )}
            </Card>
          </>
        ) : said ? (
          <>
            <Card>
              <div style={{
                display: 'flex', alignItems: 'center', gap: space.sm, marginBottom: space.xs
              }}>
                <span aria-hidden="true" style={{
                  width: 10, height: 10, borderRadius: 5, flexShrink: 0,
                  background: state === 'on' ? colour.accent
                    : state === 'blocked' ? colour.warning : colour.inkFainter
                }} />
                <span style={{ ...text('bodyStrong'), color: colour.ink }}>{said.title}</span>
              </div>
              <div style={{ ...text('body'), color: colour.inkMuted, lineHeight: 1.6 }}>
                {said.detail}
              </div>

              {said.action && (
                <button onClick={toggle} disabled={busy}
                  style={{
                    marginTop: space.md, width: '100%', minHeight: 48, cursor: 'pointer',
                    borderRadius: radius.control, border: 'none',
                    background: state === 'on' ? 'transparent' : colour.accent,
                    boxShadow: state === 'on' ? `inset 0 0 0 1px ${colour.line}` : 'none',
                    color: state === 'on' ? colour.inkMuted : 'white',
                    ...text('bodyStrong')
                  }}>
                  {busy ? 'Just a moment…' : said.action}
                </button>
              )}
            </Card>

            <SectionLabel>What gets sent</SectionLabel>
            <Card>
              <div style={{ ...text('body'), color: colour.inkMuted, lineHeight: 1.6 }}>
                Messages in the team channels, and nothing else — not bookings,
                not timesheets, not leave. More will be added once this is
                working on everybody’s phone, and only where a buzz is worth it.
              </div>
            </Card>
          </>
        ) : (
          <Banner tone="info">Checking this device…</Banner>
        )}

        {/* Only where it is true, and only as a footnote. Somebody whose
            notifications work does not need to read about service workers. */}
        {!pushPossible() && installed() && (
          <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: space.md, lineHeight: 1.6 }}>
            This device reports no support for push notifications. On an iPhone
            that usually means iOS 16.3 or older.
          </div>
        )}
      </Body>
    </Page>
  )
}
