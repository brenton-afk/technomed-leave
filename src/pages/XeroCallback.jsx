import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function XeroCallback() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('Connecting to Xero…')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    if (code) {
      setStatus('Authorising with Xero…')
      fetch(`/api/xero/token?code=${code}`)
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            setStatus('Connected! Redirecting…')
            setTimeout(() => navigate('/'), 1200)
          } else {
            setStatus('Connection failed. Please try again.')
          }
        })
        .catch(() => setStatus('Connection failed. Please try again.'))
    } else {
      setStatus('No authorisation code received.')
    }
  }, [navigate])

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: 16,
      background: '#f0f3f7',
      padding: 24
    }}>
      <div style={{
        width: 48,
        height: 48,
        borderRadius: '50%',
        background: '#1a2b4a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 22
      }}>⚙️</div>
      <p style={{ fontWeight: 600, color: '#1a2b4a', fontSize: 16 }}>{status}</p>
    </div>
  )
}
