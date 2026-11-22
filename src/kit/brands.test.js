import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { brandFor } from './brands.js'

describe('the maker and picture on a kit tile', () => {
  it('knows the makers, with a logo where a guide has one', () => {
    expect(brandFor('Mariner')).toMatchObject({ maker: 'SeaSpine', pic: '/kit-art/mariner.jpg', logo: '/kit-art/logo-seaspine.png' })
    expect(brandFor('Shoreline')).toMatchObject({ maker: 'SeaSpine', pic: '/kit-art/shoreline.jpg' })
    expect(brandFor('Dakota')).toMatchObject({ maker: 'Precision Spine', logo: '/kit-art/logo-precision-spine.png' })
    expect(brandFor('Global BMD PLIF')).toMatchObject({ maker: 'Global Biomedica' })
    expect(brandFor('CYLOX')).toMatchObject({ maker: 'SIGNUS', pic: '/kit-art/cylox.jpg' })
    expect(brandFor('MOBIS')).toMatchObject({ maker: 'SIGNUS', pic: '/kit-art/mobis.jpg' })
    expect(brandFor('Forza XP')).toMatchObject({ maker: 'Orthofix', pic: '/kit-art/forza.jpg', logo: '/kit-art/logo-orthofix.png' })
    expect(brandFor('Ascot')).toMatchObject({ pic: '/kit-art/ascot.jpg' })
    expect(brandFor('Athlet')).toMatchObject({ pic: '/kit-art/athlet.jpg' })
    expect(brandFor('Catenary ALIF')).toMatchObject({ maker: 'Global Biomedica', logo: '/kit-art/logo-global-biomedica.png', pic: '/kit-art/catenary.jpg' })
    expect(brandFor('Diplomat')).toMatchObject({ maker: 'SIGNUS', logo: '/kit-art/logo-signus.png' })
    expect(brandFor('TM Cercess')).toMatchObject({ maker: 'SIGNUS', logo: '/kit-art/logo-signus.png', pic: '/kit-art/cercess.jpg' })
    expect(brandFor('Arthrex Mini Drill 300')).toMatchObject({ maker: 'Arthrex', logo: '/kit-art/logo-arthrex.png', pic: '/kit-art/arthrex-drill.jpg' })
    expect(brandFor('NewClip Trans-Articular Screw')).toMatchObject({ maker: 'Newclip Technics', logo: '/kit-art/logo-newclip.png' })
    expect(brandFor('Boost UltraFibres')).toMatchObject({ maker: 'Australian Biotechnologies', pic: '/kit-art/boost.jpg' })
    expect(brandFor('Orthofix Firebird')).toMatchObject({ maker: 'Orthofix', pic: '/kit-art/firebird.jpg' })
    expect(brandFor('TM Corpectomy')).toMatchObject({ maker: 'TechnoMed', initial: 'C' })
    expect(brandFor('Something new')).toMatchObject({ maker: '', pic: '', initial: 'S' })
  })
  it('every picture and logo named is in public/kit-art', () => {
    for (const s of ['Mariner', 'Mariner Outrigger', 'Shoreline', 'Fathom', 'Diplomat', 'Athlet', 'Ascot', 'MOBIS', 'CYLOX', 'Catenary ALIF', 'Orthofix Firebird', 'Forza XP', 'Dakota', 'Reform Cervical', 'Global BMD PLIF', 'Lonestar', 'Nuvasive', 'Brainlab', 'TM Cercess', 'TM Corpectomy', 'Arthrex Mini Drill 300', 'NewClip Trans-Articular Screw', 'Boost UltraFibres']) {
      const b = brandFor(s)
      for (const f of [b.pic, b.logo].filter(Boolean)) expect(existsSync(`public${f}`), f).toBe(true)
    }
  })
})

describe('logos drawn to about the same size', () => {
  it('gives every logo a height from its shape, wide ones lower, stacked ones taller', async () => {
    const { logoHeight } = await import('./brands.js')
    const sea = brandFor('Mariner'), glob = brandFor('Global BMD PLIF'), ortho = brandFor('Lonestar')
    for (const b of [sea, glob, ortho]) expect(b.logoH).toBeGreaterThanOrEqual(14)
    expect(sea.logoH).toBeLessThan(glob.logoH)
    const areas = [[sea, 5.25], [glob, 3.07], [ortho, 2.8]].map(([b, a]) => b.logoH * b.logoH * a)
    expect(Math.max(...areas) / Math.min(...areas)).toBeLessThan(1.35)
    expect(logoHeight(1)).toBe(24)
    expect(brandFor('Nuvasive').logoH).toBe(0)
  })
})

describe('the name on a tile', () => {
  it('does not repeat the maker its logo already shows', async () => {
    const { tileName, displayName } = await import('./brands.js')
    expect(tileName('NewClip Trans-Articular Screw')).toBe('Trans-Articular Screw')
    expect(tileName('Arthrex Mini Drill 300')).toBe('Drill Saw Mini 300')
    expect(displayName('Arthrex Mini Drill 300')).toBe('Arthrex Drill Saw Mini 300')
    expect(tileName('Orthofix Firebird')).toBe('Firebird')
    expect(tileName('Diplomat')).toBe('Diplomat')
    expect(tileName('Nuvasive')).toBe('Nuvasive')
  })
})

describe('pictures added 22 Nov 2026', () => {
  it('gives Newclip, the TM locking distractor and the TM corpectomy set their pictures, and keeps the renamed systems branded', () => {
    expect(brandFor('NewClip Trans-Articular Screw').pic).toBe('/kit-art/newclip.jpg')
    expect(brandFor('TM Locking Distractor')).toMatchObject({ maker: 'TechnoMed', pic: '/kit-art/tm-locking-distractor.jpg' })
    expect(brandFor('TM Corpectomy')).toMatchObject({ maker: 'TechnoMed', pic: '/kit-art/tm-corpectomy.jpg' })
    expect(brandFor('Catenary')).toMatchObject({ maker: 'Global Biomedica', pic: '/kit-art/catenary.jpg' })
    expect(brandFor('Global BMD')).toMatchObject({ maker: 'Global Biomedica', pic: '/kit-art/global-plif.jpg' })
  })
})
