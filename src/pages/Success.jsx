import React from 'react'
import { useNavigate } from 'react-router-dom'

export default function Success() {
  const navigate = useNavigate()

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
        background: '#042746',
        padding: '52px 20px 32px',
        textAlign: 'center'
      }}>
        <img src="/logo.png" alt="TechnoMed" style={{ height: 44, width: 'auto', marginBottom: 6 }} />
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 20 }}>Staff Portal</div>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(42,181,160,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 28 }}>✓</div>
        <h1 style={{ color: 'white', fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Application submitted!</h1>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, lineHeight: 1.7, maxWidth: 320, margin: '0 auto' }}>
          Your leave application has been sent to management for consideration and approval. You will receive an email notification once it has been approved.
        </p>
      </div>

      <div style={{ padding: '24px 20px', flex: 1 }}>
        <div style={{ background: 'white', borderRadius: 12, padding: '16px 18px', border: '1px solid rgba(26,43,74,0.08)', marginBottom: 16, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 24 }}>📧</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#042746', marginBottom: 3 }}>Management notified</div>
            <div style={{ fontSize: 13, color: '#6b7a8d', lineHeight: 1.5 }}>Erin and Brenton have been sent your application and will review it shortly.</div>
          </div>
        </div>

        <div style={{ background: 'rgba(42,181,160,0.07)', border: '1px solid rgba(42,181,160,0.2)', borderRadius: 12, padding: '14px 16px', marginBottom: 24, fontSize: 13, color: '#6b7a8d', lineHeight: 1.6 }}>
          💡 Once approved, your leave will be automatically added to the TechnoMed calendar and lodged in Xero.
        </div>

        <button onClick={() => navigate('/')} style={{ width: '100%', padding: 14, borderRadius: 10, border: 'none', background: '#042746', color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          Submit another application
        </button>
      </div>
    </div>
  )
}