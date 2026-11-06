import React from 'react'
import { createRoot } from 'react-dom/client'
import ScanTab from './src/pages/ScanTab.jsx'
window.fetch = async () => new Response(JSON.stringify({ records: [], rows: [], trackingFrom: '2026-11-06' }), { headers: { 'Content-Type': 'application/json' } })
createRoot(document.getElementById('root')).render(<div className="tm-shell"><div className="tm-scroll"><ScanTab user={{ name: 'Test Person', email: 't@technomed.com.au', token: 'x' }} /></div></div>)
