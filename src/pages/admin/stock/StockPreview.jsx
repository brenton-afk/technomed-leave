import React, { useState, Suspense, lazy } from 'react'
import { NavGroup, NavCard } from '../../../design/Shell.jsx'
import { IconStock, IconScan, IconChart, IconKit, IconTasks, IconFile, IconSearch } from '../../../design/icons.jsx'
import { useBackLayer } from '../../../backButton.js'
import { font, amberSoft, amberInk, muted, navy } from './ui.js'

// ─── Stock on hand, as working screens (Brent, 22 Nov 2026) ──────────────────
// "Can we wire in these stock on hand modules into my admin portal for now
// (not visible by anyone else). I want to have a play with them and give
// feedback." The twelve mock-ups (claude.ai/artifact/DhntrzaARgzpwbwfSnnRmN)
// as screens that respond to taps, on made-up data. Nothing is read from or
// saved to anywhere; reached only from Admin when the server's
// `stock-preview-access` answers 200 (STOCK_PREVIEW_USERS, default Brent).

const SCREENS = {
  main: { label: 'Stock on hand', detail: 'Size grid by system, where each size is, par', kind: 'desktop', load: () => import('./screens/Main.jsx') },
  item: { label: 'Find an implant', detail: 'One code: where it is and what happened to it', kind: 'phone', load: () => import('./screens/PhoneItem.jsx') },
  resupply: { label: 'Resupply and back orders', detail: 'What distributors owe, cases, dockets', kind: 'desktop', load: () => import('./screens/DesktopResupply.jsx') },
  phoneResupply: { label: 'Waiting on distributors', detail: 'The same, on a phone', kind: 'phone', load: () => import('./screens/PhoneResupply.jsx') },
  billing: { label: 'Case billing from usage', detail: 'Admins only — replaces the bookings doc', kind: 'desktop', load: () => import('./screens/DesktopBilling.jsx') },
  stocktake: { label: 'Stocktake · choose a tray', detail: 'Trays, restock boxes and erectors to count', kind: 'phone', load: () => import('./screens/PhoneStocktake.jsx') },
  count: { label: 'Stocktake · count a tray', detail: 'Tap to count each slot', kind: 'phone', load: () => import('./screens/PhoneCount.jsx') },
  review: { label: 'Stocktake · explain the differences', detail: 'What did not match, and why', kind: 'phone', load: () => import('./screens/PhoneReview.jsx') },
  teach: { label: 'Teach the portal a tray', detail: 'Photo of a full tray, slots named', kind: 'phone', load: () => import('./screens/PhoneTeach.jsx') },
  restock: { label: 'Restock a tray', detail: 'Before and after photos — replaces the WhatsApp photo', kind: 'phone', load: () => import('./screens/PhoneRestock.jsx') },
  leader: { label: 'Team leader · which trays to open', detail: 'The week ahead against what is on the trays', kind: 'phone', load: () => import('./screens/PhoneLeader.jsx') },
  flow: { label: 'How stock moves', detail: 'The whole picture on one page', kind: 'desktop', load: () => import('./screens/DesktopFlow.jsx') }
}

const loaded = {}
const screenOf = id => (loaded[id] ||= lazy(SCREENS[id].load))

const GROUPS = [
  ['Seeing stock', [['main', IconStock], ['item', IconSearch]]],
  ['Resupply and billing', [['resupply', IconChart], ['phoneResupply', IconChart], ['billing', IconFile]]],
  ['Stocktake and restocking', [['stocktake', IconTasks], ['count', IconTasks], ['review', IconTasks], ['teach', IconScan], ['restock', IconScan], ['leader', IconKit]]],
  ['How it fits together', [['flow', IconKit]]]
]

const TINTS = ['teal', 'navy', 'amber', 'sky', 'grape', 'ocean', 'rose', 'slate']

// Which screen is open is held by Admin (`open` / `onOpen`), so the band's
// back arrow returns to this list, not to the Admin hub (Brent, 22 Nov 2026).
export default function StockPreview({ open: shown, onOpen }) {
  const [own, setOwn] = useState(null)
  const open = onOpen ? shown : own
  const setOpen = onOpen || setOwn
  const go = id => { if (SCREENS[id]) setOpen(id) }
  const close = () => setOpen(null)
  useBackLayer(!!open, close)

  return (
    <div data-stock-preview style={{ fontFamily: font }}>
      <div data-preview-note style={{ background: amberSoft, color: amberInk, borderRadius: 12, padding: '10px 12px', fontSize: 13, lineHeight: 1.45, marginBottom: 12 }}>
        <strong>Preview — only you can see this.</strong> Made-up codes, counts and surnames. Tap things to try them; nothing is saved or sent.
      </div>
      {!open && GROUPS.map(([label, items], gi) => (
        <NavGroup key={label} label={label} first={gi === 0}>
          {items.map(([id, Icon], i) => (
            <NavCard key={id} icon={Icon} tint={TINTS[(gi * 3 + i) % TINTS.length]} label={SCREENS[id].label}
              detail={`${SCREENS[id].kind === 'phone' ? 'Phone' : 'Desktop'} · ${SCREENS[id].detail}`} onClick={() => go(id)} />
          ))}
        </NavGroup>
      ))}
      {open && <Opened id={open} go={go} close={close} />}
    </div>
  )
}

function Opened({ id, go, close }) {
  const Screen = screenOf(id)
  const phone = SCREENS[id].kind === 'phone'
  return (
    <div data-preview-screen={id}>
      <button onClick={close} data-preview-back style={{ font: `600 13px ${font}`, color: navy, background: 'none', border: 0, padding: '4px 0 10px', cursor: 'pointer' }}>‹ All stock screens</button>
      <div style={phone
        ? { maxWidth: 420, margin: '0 auto', borderRadius: 22, overflow: 'hidden', border: '1px solid #dfe5ec', background: '#f4f6f8' }
        : { borderRadius: 16, overflow: 'hidden', border: '1px solid #dfe5ec', background: '#f4f6f8' }}>
        <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: muted }}>Loading…</div>}>
          <Screen go={go} />
        </Suspense>
      </div>
    </div>
  )
}

export { SCREENS }
