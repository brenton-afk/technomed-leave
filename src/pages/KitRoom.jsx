import React, { useState, useEffect } from 'react'
import { Page, Header, Body } from '../design/Shell.jsx'
import { colour, text, space, radius, border } from '../design/tokens.js'


const DISTRIBUTORS = {
  signus: { name: 'Signus', logo: '/logos/signus.png', color: colour.danger, kits: ['Diplomat', 'Athlet', 'Ascot', 'MOBIS'] },
  e4surgical: { name: 'E4 Surgical', logo: '/logos/e4surgical.png', color: '#2c3e6b', kits: ['Dakota', 'Reform Cervical', 'Reform Lumbar', 'E4 Global PLIF', 'E4 Global ALIF'] },
  devicetech: { name: 'Device Technologies', logo: '/logos/devicetech.png', color: '#8e24aa', kits: ['Mariner', 'Shoreline'] },
  orthofix: { name: 'Orthofix', logo: '/logos/orthofix.png', color: '#0077c8', kits: ['Orthofix Connectors'] },
  technomed: { name: 'TechnoMed', logo: '/logo.png', color: colour.navy, kits: ['TM Screw Removal', 'TM Locking Distractor'] },
}

function getDistributor(kitName) {
  for (const [id, dist] of Object.entries(DISTRIBUTORS)) {
    if (dist.kits.includes(kitName)) return { id, ...dist }
  }
  return null
}

const LOCATIONS = [
  {
    id: 'calvary',
    name: 'Calvary Lenah Valley',
    icon: '🏥',
    address: 'Lenah Valley, TAS',
    color: '#1a7a6e',
    categories: {
      consignment: [
        'Diplomat', 'Shoreline', 'Dakota', 'MOBIS', 'E4 Global PLIF',
        'E4 Global ALIF', 'Ascot', 'TM Screw Removal', 'Orthofix Connectors', 'TM Locking Distractor'
      ],
      loan: [],
      loanset: []
    }
  },
  {
    id: 'rhh',
    name: 'Royal Hobart Hospital',
    icon: '🏨',
    address: 'Liverpool St, Hobart TAS',
    color: colour.navy,
    categories: {
      consignment: [
        'Diplomat', 'Mariner', 'E4 Global PLIF', 'Ascot',
        'Athlet', 'Shoreline', 'Dakota', 'Reform Cervical'
      ],
      loan: [],
      loanset: []
    }
  },
  {
    id: 'warehouse',
    name: 'TechnoMed Warehouse',
    icon: '🏭',
    address: '295 Elizabeth St, North Hobart',
    color: '#2a3a5c',
    categories: {
      consignment: null,
      loan: ['Reform Lumbar', 'Dakota'],
      loanset: []
    }
  }
]

const CAT_LABELS = {
  consignment: 'Consignment',
  loan: 'TM Long Term Loan',
  loanset: 'Loan Set'
}

const STATUS_OPTIONS = [
  { id: 'ok', label: 'In Stock', color: '#1a7a6e', bg: '#e6f4f2' },
  { id: 'low', label: 'Needs Restock', color: '#856404', bg: '#fff3cd' },
  { id: 'out', label: 'Out of Stock', color: colour.danger, bg: colour.dangerSoft },
  { id: 'away', label: 'On Loan', color: '#5c6bc0', bg: '#ede7f6' }
]

export default function KitRoom({ user, onBack }) {
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [selectedCat, setSelectedCat] = useState(null)
  const [kitStatuses, setKitStatuses] = useState({})
  const [editingKit, setEditingKit] = useState(null)
  const [moveModal, setMoveModal] = useState(null)
  const [moveTarget, setMoveTarget] = useState('')
  const [comment, setComment] = useState('')
  const [history, setHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)

  function getStatus(locationId, cat, kitName) {
    return kitStatuses[`${locationId}:${cat}:${kitName}`] || 'ok'
  }

  function setStatus(locationId, cat, kitName, status) {
    const key = `${locationId}:${cat}:${kitName}`
    setKitStatuses(prev => ({ ...prev, [key]: status }))
    addHistory(`${kitName} status updated to "${STATUS_OPTIONS.find(s=>s.id===status)?.label}" by ${user?.name?.split(' ')[0]}`)
  }

  function addHistory(entry) {
    const now = new Date()
    const time = now.toLocaleString('en-AU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
    setHistory(prev => [{ text: entry, time }, ...prev].slice(0, 50))
  }

  function handleMove() {
    if (!moveTarget || !moveModal) return
    const { kitName } = moveModal
    addHistory(`${kitName} moved from ${selectedLocation.name} to ${LOCATIONS.find(l=>l.id===moveTarget)?.name}${comment ? ` — ${comment}` : ''} by ${user?.name?.split(' ')[0]}`)
    setMoveModal(null)
    setMoveTarget('')
    setComment('')
  }

  const statusInfo = (s) => STATUS_OPTIONS.find(o => o.id === s) || STATUS_OPTIONS[0]

  // Location list view
  if (!selectedLocation) {
    return (
      <Page style={{ display:'flex', flexDirection:'column' }}>
        <Header eyebrow="Kit and stock" title="Kit Room" subtitle="Select a location to view kits" onBack={onBack} />

        <div style={{ padding:16, flex:1 }}>
          {LOCATIONS.map(loc => (
            <button key={loc.id} onClick={() => setSelectedLocation(loc)} style={{ width:'100%', background:'white', border:'1px solid rgba(26,43,74,0.08)', borderRadius:14, padding:0, marginBottom:12, cursor:'pointer', overflow:'hidden', textAlign:'left', display:'block' }}>
              <div style={{ background:loc.color, padding:'16px 18px', display:'flex', alignItems:'center', gap:12 }}>
                <span style={{ fontSize:28 }}>{loc.icon}</span>
                <div>
                  <div style={{ fontSize:16, fontWeight:700, color:'white' }}>{loc.name}</div>
                  <div style={{ fontSize:12.5, color:'rgba(255,255,255,0.6)', marginTop:2 }}>📍 {loc.address}</div>
                </div>
              </div>
              <div style={{ padding:'12px 18px', display:'flex', gap:8, flexWrap:'wrap' }}>
                {Object.entries(loc.categories).filter(([,kits]) => kits && kits.length > 0).map(([cat, kits]) => (
                  <span key={cat} style={{ fontSize:12.5, background:colour.canvas, color:colour.inkFaint, padding:'4px 10px', borderRadius:20, fontWeight:500 }}>
                    {CAT_LABELS[cat]} ({kits.length})
                  </span>
                ))}
              </div>
            </button>
          ))}

          {history.length > 0 && (
            <button onClick={() => setShowHistory(!showHistory)} style={{ width:'100%', padding:'12px 16px', background:'white', border:'1px solid rgba(26,43,74,0.08)', borderRadius:12, cursor:'pointer', textAlign:'left', marginTop:4 }}>
              <div style={{ fontSize:14, fontWeight:600, color:colour.navy }}>📋 Movement History {showHistory ? '▲' : '▼'}</div>
            </button>
          )}

          {showHistory && history.map((h, i) => (
            <div key={i} style={{ background:'white', borderRadius:10, padding:'10px 14px', marginTop:6, border:'1px solid rgba(26,43,74,0.06)' }}>
              <div style={{ fontSize:14, color:colour.navy }}>{h.text}</div>
              <div style={{ fontSize:12.5, color:colour.inkFainter, marginTop:3 }}>{h.time}</div>
            </div>
          ))}
        </div>
      </Page>
    )
  }

  // Category list view
  if (!selectedCat) {
    const cats = Object.entries(selectedLocation.categories).filter(([,kits]) => kits !== null)
    return (
      <div style={{ minHeight:'100%', background:colour.canvas, fontFamily:'-apple-system,sans-serif', display:'flex', flexDirection:'column' }}>
        <div style={{ background:selectedLocation.color, paddingTop:56, paddingLeft:20, paddingRight:20, paddingBottom:24 }}>
          <button onClick={() => setSelectedLocation(null)} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.6)', fontSize:14, cursor:'pointer', padding:0, marginBottom:12 }}>← All Locations</button>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <span style={{ fontSize:36 }}>{selectedLocation.icon}</span>
            <div>
              <div style={{ fontSize:19, fontWeight:700, color:'white' }}>{selectedLocation.name}</div>
              <div style={{ fontSize:12.5, color:'rgba(255,255,255,0.55)' }}>📍 {selectedLocation.address}</div>
            </div>
          </div>
        </div>

        <div style={{ padding:16, flex:1 }}>
          {cats.map(([cat, kits]) => {
            const statusCounts = kits.reduce((acc, kit) => {
              const s = getStatus(selectedLocation.id, cat, kit)
              acc[s] = (acc[s] || 0) + 1
              return acc
            }, {})
            const hasIssues = statusCounts.low > 0 || statusCounts.out > 0
            return (
              <button key={cat} onClick={() => setSelectedCat(cat)} style={{ width:'100%', background:'white', border:`1px solid ${hasIssues ? '#f6c026' : 'rgba(26,43,74,0.08)'}`, borderRadius:14, padding:'16px 18px', marginBottom:12, cursor:'pointer', textAlign:'left', display:'block' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div>
                    <div style={{ fontSize:16, fontWeight:700, color:colour.navy, marginBottom:4 }}>{CAT_LABELS[cat]}</div>
                    <div style={{ fontSize:14, color:colour.inkFaint }}>{kits.length} kit{kits.length!==1?'s':''}</div>
                  </div>
                  {hasIssues && <span style={{ fontSize:19 }}>⚠️</span>}
                </div>
                <div style={{ display:'flex', gap:6, marginTop:10, flexWrap:'wrap' }}>
                  {Object.entries(statusCounts).map(([s, count]) => {
                    const si = statusInfo(s)
                    return <span key={s} style={{ fontSize:12.5, background:si.bg, color:si.color, padding:'3px 8px', borderRadius:20, fontWeight:500 }}>{count} {si.label}</span>
                  })}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // Kit list view
  const kits = selectedLocation.categories[selectedCat] || []
  return (
    <div style={{ minHeight:'100%', background:colour.canvas, fontFamily:'-apple-system,sans-serif', display:'flex', flexDirection:'column' }}>
      <div style={{ background:selectedLocation.color, paddingTop:56, paddingLeft:20, paddingRight:20, paddingBottom:24 }}>
        <button onClick={() => setSelectedCat(null)} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.6)', fontSize:14, cursor:'pointer', padding:0, marginBottom:12 }}>← {selectedLocation.name}</button>
        <div style={{ fontSize:19, fontWeight:700, color:'white', marginBottom:2 }}>{CAT_LABELS[selectedCat]}</div>
        <div style={{ fontSize:14, color:'rgba(255,255,255,0.55)' }}>{kits.length} kits</div>
      </div>

      <div style={{ padding:16, flex:1, paddingBottom:100 }}>
        {kits.map(kit => {
          const s = getStatus(selectedLocation.id, selectedCat, kit)
          const si = statusInfo(s)
          const isEditing = editingKit === `${selectedLocation.id}:${selectedCat}:${kit}`
          return (
            <div key={kit} style={{ background:'white', borderRadius:12, marginBottom:10, overflow:'hidden', border:'1px solid rgba(26,43,74,0.06)' }}>
              <div style={{ padding:'14px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  {getDistributor(kit) && <img src={getDistributor(kit).logo} alt={getDistributor(kit).name} style={{ height:28, width:'auto', objectFit:'contain', maxWidth:70 }} />}
                  <div>
                    <div style={{ fontSize:14, fontWeight:600, color:colour.navy }}>{kit}</div>
                    <span style={{ fontSize:12.5, background:si.bg, color:si.color, padding:'2px 8px', borderRadius:20, fontWeight:500, display:'inline-block', marginTop:4 }}>{si.label}</span>
                  </div>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={() => setMoveModal({ kitName: kit })} style={{ padding:'6px 12px', background:colour.canvas, border:'none', borderRadius:8, fontSize:12.5, color:colour.inkFaint, cursor:'pointer' }}>Move</button>
                  <button onClick={() => setEditingKit(isEditing ? null : `${selectedLocation.id}:${selectedCat}:${kit}`)} style={{ padding:'6px 12px', background: isEditing?colour.navy:colour.canvas, border:'none', borderRadius:8, fontSize:12.5, color: isEditing?'white':colour.inkFaint, cursor:'pointer' }}>Update</button>
                </div>
              </div>
              {isEditing && (
                <div style={{ padding:'0 16px 14px', borderTop:'1px solid rgba(26,43,74,0.06)' }}>
                  <div style={{ fontSize:12.5, color:colour.inkFaint, marginBottom:8, marginTop:10 }}>Update kit status:</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                    {STATUS_OPTIONS.map(opt => (
                      <button key={opt.id} onClick={() => { setStatus(selectedLocation.id, selectedCat, kit, opt.id); setEditingKit(null) }}
                        style={{ padding:'10px 8px', background: s===opt.id ? opt.bg : '#f8f9fc', border:`1.5px solid ${s===opt.id ? opt.color : 'transparent'}`, borderRadius:8, fontSize:14, color: opt.color, cursor:'pointer', fontWeight: s===opt.id?'700':'400' }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {moveModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', padding:20, zIndex:1000 }}>
          <div style={{ background:'white', borderRadius:16, padding:24, width:'100%', maxWidth:400 }}>
            <div style={{ fontSize:19, fontWeight:700, color:colour.navy, marginBottom:6 }}>Move Kit</div>
            <div style={{ fontSize:14, color:colour.inkFaint, marginBottom:16 }}>Move <strong>{moveModal.kitName}</strong> from {selectedLocation.name} to:</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:16 }}>
              {LOCATIONS.filter(l => l.id !== selectedLocation.id).map(loc => (
                <button key={loc.id} onClick={() => setMoveTarget(loc.id)}
                  style={{ padding:'12px 14px', background: moveTarget===loc.id?'#e6f4f2':'#f8f9fc', border:`1.5px solid ${moveTarget===loc.id?'#1a7a6e':'transparent'}`, borderRadius:10, fontSize:14, color:colour.navy, cursor:'pointer', textAlign:'left' }}>
                  {loc.icon} {loc.name}
                </button>
              ))}
            </div>
            <textarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="Add a note (optional)..." rows={2}
              style={{ width:'100%', padding:'10px 12px', border:'1px solid rgba(26,43,74,0.15)', borderRadius:8, fontSize:14, resize:'none', outline:'none', boxSizing:'border-box', marginBottom:14, fontFamily:'inherit' }} />
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => { setMoveModal(null); setMoveTarget(''); setComment('') }} style={{ flex:1, padding:12, background:colour.canvas, border:'none', borderRadius:8, fontSize:14, cursor:'pointer', color:colour.inkFaint }}>Cancel</button>
              <button onClick={handleMove} disabled={!moveTarget}
                style={{ flex:2, padding:12, background: moveTarget?colour.navy:'#ccc', color:'white', border:'none', borderRadius:8, fontSize:14, fontWeight:600, cursor: moveTarget?'pointer':'not-allowed' }}>
                Confirm Move
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
