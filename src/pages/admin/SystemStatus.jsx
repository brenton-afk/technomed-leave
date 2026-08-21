import React, { useState, useEffect, useMemo } from 'react'

const NAVY = '#042746'
const TEAL = '#189a85'
const BLUE = '#2899d4'
const RED = '#c0392b'
const MUTED = '#6b7a8d'
const BORDER = 'rgba(26,43,74,0.12)'

// What this deployment can actually reach. Exists because diagnosing "X is not
// configured" from the outside is guesswork: the API report behind this screen
// needs an Authorization header, so it cannot be opened in a browser address
// bar. This renders it somewhere the session token is already available.

const GROUPS = [
  {
    title: 'Usage scanning',
    keys: ['ANTHROPIC_API_KEY', 'DROPBOX_ACCESS_TOKEN'],
    note: 'Reading usage forms needs the Anthropic key; filing them needs Dropbox.'
  },
  {
    title: 'Timesheet reminders',
    keys: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER', 'CRON_SECRET'],
    note: 'Saturday and Sunday SMS. Staff also need a mobile number in staffConfig.'
  },
  {
    title: 'Core',
    keys: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'RESEND_API_KEY', 'GOOGLE_SERVICE_ACCOUNT_JSON'],
    note: 'Storage, email and calendar. The app cannot run without these.'
  },
  {
    title: 'Xero',
    keys: ['XERO_CLIENT_ID', 'XERO_CLIENT_SECRET', 'XERO_REDIRECT_URI'],
    note: 'Credentials only — the live connection is shown above.'
  }
]

export default function SystemStatus({ user }) {
  const [env, setEnv] = useState(null)
  const [xero, setXero] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${user?.token || ''}` }), [user])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError('')
    try {
      const [envRes, xeroRes] = await Promise.all([
        fetch('/api/xero/info?action=env', { headers: authHeaders }).then(r => r.json()),
        fetch('/api/xero/info?action=status', { headers: authHeaders }).then(r => r.json())
      ])
      if (envRes.error) throw new Error(envRes.error)
      setEnv(envRes)
      setXero(xeroRes)
    } catch (err) { setError(err.message) }
    setLoading(false)
  }

  const xeroBroken = xero && (!xero.connected || xero.expired)

  return (
    <div>
      {error && <div style={{ background:'#fdecea', color:RED, padding:12, borderRadius:10, fontSize:13, marginBottom:12 }}>{error}</div>}
      {loading && <div style={{ textAlign:'center', padding:30, color:MUTED, fontSize:14 }}>Checking…</div>}

      {/* Xero first — it lapses on a timer, so it is the most common breakage */}
      {xero && (
        <div style={{ background:'white', borderRadius:12, padding:15, marginBottom:12, border:`1px solid ${xeroBroken ? 'rgba(192,57,43,0.35)' : BORDER}` }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, marginBottom: xeroBroken ? 10 : 0 }}>
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:NAVY }}>Xero connection</div>
              <div style={{ fontSize:11.5, color:MUTED, marginTop:2 }}>
                {xero.connected
                  ? `Last authorised until ${new Date(xero.expires_at).toLocaleString('en-AU', { day:'numeric', month:'short', hour:'numeric', minute:'2-digit' })}`
                  : 'Never connected'}
              </div>
            </div>
            <span style={{ fontSize:11, fontWeight:700, padding:'4px 10px', borderRadius:20, whiteSpace:'nowrap',
              background: xeroBroken ? '#fdecea' : '#e6f4f2', color: xeroBroken ? RED : TEAL }}>
              {!xero.connected ? 'Not connected' : xero.expired ? 'Expired' : 'Connected'}
            </span>
          </div>
          {xeroBroken && (
            <>
              <div style={{ fontSize:12.5, color:MUTED, lineHeight:1.55, marginBottom:10 }}>
                Timesheets, leave approvals and leave balances all fail while this is expired.
                Reconnecting takes one approval in Xero.
              </div>
              <a href="/api/xero/connect"
                style={{ display:'block', padding:12, background:TEAL, color:'white', borderRadius:10, fontSize:14, fontWeight:700, textAlign:'center', textDecoration:'none' }}>
                Reconnect Xero →
              </a>
            </>
          )}
        </div>
      )}

      {env && (
        <>
          {env.missing.length === 0 ? (
            <div style={{ background:'#e6f4f2', color:TEAL, padding:12, borderRadius:10, fontSize:13, marginBottom:12, lineHeight:1.5 }}>
              ✓ Every integration variable is configured on this deployment.
            </div>
          ) : (
            <div style={{ background:'#fff8e6', border:'1px solid rgba(245,158,11,0.3)', borderRadius:10, padding:'12px 14px', marginBottom:12 }}>
              <div style={{ fontSize:12.5, fontWeight:700, color:'#8a5a00', marginBottom:6 }}>
                {env.missing.length} setting{env.missing.length === 1 ? '' : 's'} missing from this deployment
              </div>
              <div style={{ fontSize:12, color:'#8a5a00', lineHeight:1.65 }}>
                Add them in Vercel → Settings → Environment Variables (tick <strong>Production</strong>),
                then <strong>redeploy</strong> — a new variable does not reach a deployment that already exists.
              </div>
            </div>
          )}

          {GROUPS.map(group => (
            <div key={group.title} style={{ background:'white', borderRadius:12, padding:15, marginBottom:10, border:`1px solid ${BORDER}` }}>
              <div style={{ fontSize:13, fontWeight:700, color:NAVY, marginBottom:2 }}>{group.title}</div>
              <div style={{ fontSize:11.5, color:MUTED, marginBottom:10, lineHeight:1.5 }}>{group.note}</div>
              {group.keys.map(key => {
                const present = env.configured[key]
                return (
                  <div key={key} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid rgba(26,43,74,0.05)', gap:8 }}>
                    <code style={{ fontSize:11.5, color: present ? NAVY : RED, fontFamily:'ui-monospace, monospace', wordBreak:'break-all' }}>{key}</code>
                    <span style={{ fontSize:11, fontWeight:700, color: present ? TEAL : RED, whiteSpace:'nowrap' }}>
                      {present ? '✓ set' : '✕ missing'}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}

          <div style={{ background:'white', borderRadius:12, padding:15, marginBottom:10, border:`1px solid ${BORDER}` }}>
            <div style={{ fontSize:13, fontWeight:700, color:NAVY, marginBottom:8 }}>This deployment</div>
            {[['Environment', env.deployment.env], ['Commit', env.deployment.commit]].map(([l, v]) => (
              <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', fontSize:12 }}>
                <span style={{ color:MUTED }}>{l}</span>
                <code style={{ color:NAVY, fontFamily:'ui-monospace, monospace' }}>{v}</code>
              </div>
            ))}
            <div style={{ fontSize:11, color:MUTED, marginTop:8, lineHeight:1.55 }}>
              If a variable you added in Vercel shows as missing here, this deployment was
              built before you added it — redeploy and it will appear.
            </div>
          </div>
        </>
      )}

      <button onClick={load} style={{ width:'100%', padding:12, background:'transparent', border:`1px solid ${BORDER}`, borderRadius:8, fontSize:13, color:MUTED, cursor:'pointer', marginTop:4 }}>
        Re-check
      </button>
    </div>
  )
}
