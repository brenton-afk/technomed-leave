import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export default function Success() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const form = state?.form || {}

  return (
    <div style={{
      minHeight: '100vh',
      maxWidth: 430,
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'column',
      background: '#f0f3f7'
    }}>
      <div style={{
        background: '#1a2b4a',
        padding: '52px 20px 24px',
        textAlign: 'center'
      }}>
        <div style={{
          width: 68,
          height: 68,
          borderRadius: '50%',
          background: 'rgba(42,181,160,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px',
          fontSize: 32
        }}>✓</div>
        <h1 style={{ color: 'white', fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
          Application submitted!
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, lineHeight: 1.6 }}>
          Your leave request has been lodged successfully
        </p>
      </div>

      <div style={{ padding: '24px 20px', flex: 1 }}>
        {/* Integration confirmations */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {[
            { icon: '📧', title: 'Email sent', desc: 'Erin, Brenton and Bookings have been notified' },
            { icon: '📅', title: 'Calendar updated', desc: 'Added to TechnoMed bookings calendar in Grape' },
            { icon: '📋', title: 'Xero lodged', desc: `Leave application pending under ${form.name || 'your'} employee record` }
          ].map(item => (
            <div key={item.title} style={{
              background: 'white',
              borderRadius: 12,
              padding: '14px 16px',
              display: 'flex',
              gap: 14,
              alignItems: 'flex-start',
              border: '1px solid rgba(26,43,74,0.08)'
            }}>
              <span style={{ fontSize: 22 }}>{item.icon}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#1a2b4a', marginBottom: 2 }}>{item.title}</div>
                <div style={{ fontSize: 12, color: '#6b7a8d' }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Xero Me tip */}
        <div style={{
          background: 'rgba(42,181,160,0.07)',
          border: '1px solid rgba(42,181,160,0.2)',
          borderRadius: 12,
          padding: '14px 16px',
          marginBottom: 24,
          fontSize: 13,
          color: '#6b7a8d',
          lineHeight: 1.6
        }}>
          💡 <strong style={{ color: '#1a2b4a' }}>Xero Me tip:</strong> You can view your leave balance and track the status of this application in the <strong style={{ color: '#1a2b4a' }}>Xero Me</strong> app on your phone.
        </div>

        <button
          onClick={() => navigate('/')}
          style={{
            width: '100%',
            padding: 14,
            borderRadius: 10,
            border: 'none',
            background: '#1a2b4a',
            color: 'white',
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Submit another application
        </button>
      </div>
    </div>
  )
}
