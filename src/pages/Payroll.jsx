import React, { useState } from 'react'
import Timesheets from './Timesheets.jsx'
import { getStaffByEmail } from '../staffConfig.js'

const NAVY = '#042746'
const TEAL = '#189a85'
const MUTED = '#6b7a8d'

const TABS = [
  { id: 'timesheets', label: 'Timesheets' },
  { id: 'payslips', label: 'Payslips' }
]

export default function Payroll({ user }) {
  const [tab, setTab] = useState('timesheets')
  // hasTimesheets is read from the roster, not the session, so enabling a staff
  // member is a one-line staffConfig change.
  const hasTimesheets = getStaffByEmail(user?.email)?.hasTimesheets === true

  return (
    <div style={{ minHeight: '100vh', background: '#f0f3f7', fontFamily: '-apple-system,sans-serif' }}>
      <div style={{ background: NAVY, paddingTop: 56, paddingLeft: 20, paddingRight: 20, paddingBottom: 16 }}>
        <img src="/logo.png" alt="TechnoMed" style={{ height: 36, width: 'auto', marginBottom: 4 }} />
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 8 }}>Payroll</div>
        <div style={{ fontSize: 19, fontWeight: 700, color: 'white', marginBottom: 14 }}>
          {tab === 'timesheets' ? 'Timesheets' : 'Payslips'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding: '7px 15px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: tab === t.id ? 'white' : 'rgba(255,255,255,0.12)', color: tab === t.id ? NAVY : 'white' }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'timesheets' && (
        hasTimesheets
          ? <Timesheets user={user} />
          : (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 38, marginBottom: 12 }}>🗓</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 6 }}>No timesheet required</div>
              <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.6 }}>
                Your role isn't set up for fortnightly timesheets.<br />Speak to Erin if that's not right.
              </div>
            </div>
          )
      )}

      {tab === 'payslips' && (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 38, marginBottom: 12 }}>💰</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 6 }}>Payslips coming soon</div>
          <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.6 }}>Pay run history will appear here once Xero payslip access is enabled.</div>
        </div>
      )}
    </div>
  )
}
