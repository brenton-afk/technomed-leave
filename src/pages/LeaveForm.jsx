import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import styles from './LeaveForm.module.css'

const STAFF = [
  { name: 'Brenton Lovering', email: 'brenton@technomed.com.au', division: 'Operations', role: 'Managing Director' },
  { name: 'Erin Smallbon', email: 'erin@technomed.com.au', division: 'Operations', role: 'General Manager' },
  { name: 'Emma Lovering', email: 'marketing@technomed.com.au', division: 'Operations', role: 'Co-Founder, Brand Lead' },
  { name: 'Toni Hoppitt', email: 'toni@technomed.com.au', division: 'Operations', role: 'Operations Coordinator' },
  { name: 'Ben Cassidy', email: 'ben@technomed.com.au', division: 'Spine', role: 'Clinical Support Specialist' },
  { name: 'Mat Usher', email: 'mat@technomed.com.au', division: 'CMF', role: 'Business Development and Director' },
  { name: 'Jeremy Sharpen', email: 'jeremy@technomed.com.au', division: 'Orthopaedics', role: 'Director of Orthopaedics' },
  { name: 'April Foale', email: 'april@technomed.com.au', division: 'Orthopaedics', role: 'Clinical Support Specialist' },
  { name: 'Aimee Vulinovich', email: 'aimee@technomed.com.au', division: 'Spine', role: 'Clinical Support Specialist' }
]

const STEPS = [
  { title: 'Your details', sub: 'Select your name from the list' },
  { title: 'Leave dates', sub: 'Select your leave period' },
  { title: 'Type of leave', sub: 'What category applies?' },
  { title: 'Reason & notes', sub: 'Brief description of your leave' },
  { title: 'Review & submit', sub: 'Confirm everything looks right' }
]

const LEAVE_TYPES = [
  { id: 'ANNUAL_LEAVE', label: 'Annual Leave', desc: 'Planned holiday or personal time off', icon: '🌴' },
  { id: 'SICK', label: 'Personal / Sick Leave', desc: 'Illness, injury or personal circumstances', icon: '💙' },
  { id: 'TOIL', label: 'Time Off In Lieu (TOIL)', desc: 'Using time accrued from overtime hours', icon: '⏱' }
]

function formatDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${parseInt(day)} ${months[parseInt(m)-1]} ${y}`
}

function leaveLabel(id) {
  return LEAVE_TYPES.find(t => t.id === id)?.label || '—'
}

export default function LeaveForm() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [balances, setBalances] = useState(null)
  const [xeroConnected, setXeroConnected] = useState(false)

  const [form, setForm] = useState({
    name: '',
    email: '',
    division: '',
    role: '',
    startDate: '',
    endDate: '',
    returnDate: '',
    leaveType: '',
    reason: ''
  })

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }))

  const selectStaff = (staffMember) => {
    setForm(prev => ({
      ...prev,
      name: staffMember.name,
      email: staffMember.email,
      division: staffMember.division,
      role: staffMember.role
    }))
  }

  useEffect(() => {
    checkXeroConnection()
  }, [])

  useEffect(() => {
    if (form.name && xeroConnected && step === 1) {
      fetchBalances(form.name)
    }
  }, [step, form.name, xeroConnected])

  async function checkXeroConnection() {
    try {
      const res = await axios.get('/api/xero/status')
      setXeroConnected(res.data.connected)
    } catch {
      setXeroConnected(false)
    }
  }

  async function fetchBalances(name) {
    try {
      const res = await axios.get(`/api/xero/balances?name=${encodeURIComponent(name)}`)
      setBalances(res.data)
    } catch {}
  }

  function validate() {
    if (step === 0) {
      if (!form.name) return 'Please select your name'
    }
    if (step === 1) {
      if (!form.startDate) return 'Please select your first day of leave'
      if (!form.endDate) return 'Please select your last day of leave'
      if (!form.returnDate) return 'Please select your return to work date'
      if (form.endDate < form.startDate) return 'Last day must be after first day'
      if (form.returnDate <= form.endDate) return 'Return date must be after last day of leave'
    }
    if (step === 2) {
      if (!form.leaveType) return 'Please select a leave type'
    }
    if (step === 3) {
      if (!form.reason.trim()) return 'Please enter a reason for your leave'
    }
    return ''
  }

  function next() {
    const err = validate()
    if (err) { setError(err); return }
    setError('')
    setStep(s => s + 1)
  }

  function back() {
    setError('')
    setStep(s => s - 1)
  }

  async function submit() {
    setSubmitting(true)
    setError('')
    try {
      await axios.post('/api/submit', form)
      navigate('/success', { state: { form } })
    } catch (e) {
      setError(e.response?.data?.error || 'Submission failed. Please try again.')
      setSubmitting(false)
    }
  }

  const progress = ((step + 1) / STEPS.length) * 100

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.stepCounter}>{step + 1} of {STEPS.length}</div>
        <div className={styles.logoRow}>
          <img src="/logo.png" alt="TechnoMed" className={styles.logoImg} />
        </div>
        <div className={styles.headerTitle}>{STEPS[step].title}</div>
        <div className={styles.headerSub}>{STEPS[step].sub}</div>
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className={styles.body}>

        {/* Step 0 — Staff selection */}
        {step === 0 && (
          <div className={styles.slide}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Select your name</label>
              <p className={styles.hint}>Tap your name from the list below</p>
              <div className={styles.staffList}>
                {STAFF.map(s => (
                  <button
                    key={s.email}
                    className={`${styles.staffBtn} ${form.name === s.name ? styles.staffBtnSelected : ''}`}
                    onClick={() => selectStaff(s)}
                  >
                    <div className={styles.staffAvatar}>
                      {s.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div className={styles.staffInfo}>
                      <div className={styles.staffName}>{s.name}</div>
                      <div className={styles.staffRole}>{s.role} · {s.division}</div>
                    </div>
                    <div className={`${styles.checkDot} ${form.name === s.name ? styles.checkDotSelected : ''}`} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 1 — Dates */}
        {step === 1 && (
          <div className={styles.slide}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>First day of leave</label>
              <input type="date" className={styles.input} value={form.startDate} onChange={e => set('startDate', e.target.value)} />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Last day of leave</label>
              <input type="date" className={styles.input} value={form.endDate} min={form.startDate} onChange={e => set('endDate', e.target.value)} />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Return to work date</label>
              <input type="date" className={styles.input} value={form.returnDate} min={form.endDate} onChange={e => set('returnDate', e.target.value)} />
            </div>
            {balances && (
              <div className={styles.balanceCard}>
                <div className={styles.balanceTitle}>Your leave balances (from Xero)</div>
                <div className={styles.balanceGrid}>
                  {balances.map(b => (
                    <div key={b.leaveType} className={styles.balanceItem}>
                      <div className={styles.balanceHours}>{b.balanceHours} hrs</div>
                      <div className={styles.balanceDays}>{(b.balanceHours / 7.6).toFixed(1)} days</div>
                      <div className={styles.balanceLabel}>{b.leaveType}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2 — Leave type */}
        {step === 2 && (
          <div className={styles.slide}>
            <div className={styles.leaveTypes}>
              {LEAVE_TYPES.map(type => (
                <button
                  key={type.id}
                  className={`${styles.leaveBtn} ${form.leaveType === type.id ? styles.leaveBtnSelected : ''}`}
                  onClick={() => set('leaveType', type.id)}
                >
                  <span className={styles.leaveIcon}>{type.icon}</span>
                  <div className={styles.leaveText}>
                    <div className={styles.leaveName}>{type.label}</div>
                    <div className={styles.leaveDesc}>{type.desc}</div>
                  </div>
                  <div className={`${styles.checkDot} ${form.leaveType === type.id ? styles.checkDotSelected : ''}`} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3 — Reason */}
        {step === 3 && (
          <div className={styles.slide}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Reason for leave</label>
              <p className={styles.hint}>This will appear in the notification email to management</p>
              <textarea
                className={styles.textarea}
                placeholder="e.g. Family holiday, medical procedure, personal matter…"
                value={form.reason}
                onChange={e => set('reason', e.target.value)}
                rows={4}
              />
            </div>
            <div className={styles.disclaimer}>
              <span>🔒</span> Your application will be reviewed by management before anything is confirmed.
            </div>
          </div>
        )}

        {/* Step 4 — Review */}
        {step === 4 && (
          <div className={styles.slide}>
            <div className={styles.summaryCard}>
              <div className={styles.summaryHeader}>Application summary</div>
              <SummaryRow label="Employee" value={form.name} />
              <SummaryRow label="Division" value={form.division} />
              <SummaryRow label="Leave type" value={leaveLabel(form.leaveType)} highlight />
              <SummaryRow label="First day" value={formatDate(form.startDate)} />
              <SummaryRow label="Last day" value={formatDate(form.endDate)} />
              <SummaryRow label="Return date" value={formatDate(form.returnDate)} />
              <SummaryRow label="Reason" value={form.reason} />
            </div>
            <div className={styles.disclaimer}>
              <span>📧</span> Management will be notified and will review your application.
            </div>
          </div>
        )}

        {error && <div className={styles.errorBox}>{error}</div>}
      </div>

      <div className={styles.navRow}>
        {step > 0 && (
          <button className={styles.btnBack} onClick={back} disabled={submitting}>Back</button>
        )}
        {step < STEPS.length - 1 ? (
          <button className={styles.btnNext} onClick={next}>Continue →</button>
        ) : (
          <button className={styles.btnSubmit} onClick={submit} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit application ✓'}
          </button>
        )}
      </div>
    </div>
  )
}

function SummaryRow({ label, value, highlight }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 14px', borderBottom: '0.5px solid rgba(26,43,74,0.08)', gap: 12 }}>
      <span style={{ fontSize: 12, color: '#6b7a8d', flexShrink: 0 }}>{label}</span>
      {highlight ? (
        <span style={{ fontSize: 12, fontWeight: 600, background: '#e6f4f2', color: '#1a7a6e', padding: '3px 10px', borderRadius: 20 }}>{value}</span>
      ) : (
        <span style={{ fontSize: 13, fontWeight: 500, color: '#1a2b4a', textAlign: 'right' }}>{value}</span>
      )}
    </div>
  )
}
