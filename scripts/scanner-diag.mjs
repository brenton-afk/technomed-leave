// Every candidate the detector considered for the named scenes, and the truth.
//   node scripts/scanner-diag.mjs "steel"
import { createRequire } from 'module'
import { benchmark, cornerError } from '../src/scanner/scenes.js'
const require = createRequire(import.meta.url)
const cv = require('../public/vendor/opencv-4.13.0.js')
await new Promise(resolve => { cv.onRuntimeInitialized = resolve })
const { detectDocument } = await import('../src/scanner/documentDetect.js')
const width = 240, height = 180
const toRgba = g => { const o = new Uint8ClampedArray(g.length * 4); for (let i = 0; i < g.length; i++) { o[i*4]=o[i*4+1]=o[i*4+2]=g[i]; o[i*4+3]=255 } return o }
const filter = process.argv[2] || ''
const fmt = cs => cs.map(c => `${Math.round(c.x)},${Math.round(c.y)}`).join(' ')
for (const s of benchmark(width, height).filter(s => s.name.includes(filter))) {
  const inspect = []
  const r = detectDocument(cv, toRgba(s.image), width, height, { inspect })
  console.log(`\n== ${s.name}  error ${r ? cornerError(r, s.quad, width, height).toFixed(1) : '—'}`)
  console.log(`   truth  ${fmt(s.quad)}`)
  if (r) console.log(`   chosen ${fmt(r.corners.map(c => ({ x: c.x * width, y: c.y * height })))}`)
  const seen = new Set()
  for (const c of inspect) {
    const key = fmt(c.corners); if (seen.has(key)) continue; seen.add(key)
    console.log(`   cand[${c.source||'c'}] ${key}  area ${c.areaFraction.toFixed(2)} sq ${c.squareness.toFixed(2)} sup ${c.edgeSupport.toFixed(2)} weak ${c.weakestSide.toFixed(2)} fill ${(c.filledSide ?? 0).toFixed(2)} mean ${Math.round(c.mean)} ring ${Math.round(c.ring)}`)
  }
}
