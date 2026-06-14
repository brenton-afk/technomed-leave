import React from 'react'

export default function ComingSoon({ title, subtitle, icon, isLocked }) {
  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column', fontFamily:'-apple-system,sans-serif' }}>
      <div style={{ background:'#042746', padding:'48px 20px 24px' }}>
        <img src="/logo.png" alt="TechnoMed" style={{ height:36, width:'auto', marginBottom:4 }} />
        <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:12 }}>{isLocked ? 'Access Denied' : 'Coming Soon'}</div>
        <div style={{ fontSize:22, fontWeight:700, color:'white' }}>{title}</div>
      </div>
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'40px 24px', background:'#f0f3f7' }}>
        <div style={{ fontSize:56, marginBottom:20 }}>{icon}</div>
        <div style={{ fontSize:15, color:'#6b7a8d', textAlign:'center', lineHeight:'1.6', maxWidth:'280px' }}>{subtitle}</div>
        {!isLocked && (
          <div style={{ marginTop:24, background:'rgba(42,181,160,0.1)', border:'1px solid rgba(42,181,160,0.3)', borderRadius:10, padding:'12px 20px', fontSize:13, color:'#1a7a6e', textAlign:'center' }}>
            This module is under development
          </div>
        )}
      </div>
    </div>
  )
}
