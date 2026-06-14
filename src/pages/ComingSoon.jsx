import React from 'react'

export default function ComingSoon({ title, subtitle, icon, isLocked }) {
  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column', fontFamily:'-apple-system,sans-serif' }}>
      <div style={{ background:'#042746', padding:'48px 20px 24px' }}>
        <img src="/logo.png" alt="TechnoMed" style={{ height:'44px', width:'auto', marginBottom:'4px' }} />
        <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1.5px', textTransform:'uppercase' }}>Staff Portal</div>
      </div>
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'40px 24px', background:'#f0f3f7' }}>
        <div style={{ fontSize:'56px', marginBottom:'20px' }}>{icon}</div>
        <div style={{ fontSize:'24px', fontWeight:'700', color:'#042746', marginBottom:'10px', textAlign:'center' }}>{title}</div>
        <div style={{ fontSize:'15px', color:'#6b7a8d', textAlign:'center', lineHeight:'1.6', maxWidth:'280px' }}>{subtitle}</div>
        {!isLocked && (
          <div style={{ marginTop:'24px', background:'rgba(42,181,160,0.1)', border:'1px solid rgba(42,181,160,0.3)', borderRadius:'10px', padding:'12px 20px', fontSize:'13px', color:'#1a7a6e', textAlign:'center' }}>
            This module is under development
          </div>
        )}
      </div>
    </div>
  )
}
