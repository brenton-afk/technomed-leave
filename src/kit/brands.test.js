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
    expect(brandFor('Catenary ALIF')).toMatchObject({ maker: '', pic: '/kit-art/catenary.jpg' })
    expect(brandFor('Orthofix Firebird')).toMatchObject({ maker: 'Orthofix', pic: '/kit-art/firebird.jpg' })
    expect(brandFor('TM Corpectomy')).toMatchObject({ maker: 'TechnoMed', initial: 'C' })
    expect(brandFor('Something new')).toMatchObject({ maker: '', pic: '', initial: 'S' })
  })
  it('every picture and logo named is in public/kit-art', () => {
    for (const s of ['Mariner', 'Mariner Outrigger', 'Shoreline', 'Fathom', 'Diplomat', 'Athlet', 'Ascot', 'MOBIS', 'CYLOX', 'Catenary ALIF', 'Orthofix Firebird', 'Forza XP', 'Dakota', 'Reform Cervical', 'Global BMD PLIF', 'Lonestar', 'Nuvasive', 'Brainlab']) {
      const b = brandFor(s)
      for (const f of [b.pic, b.logo].filter(Boolean)) expect(existsSync(`public${f}`), f).toBe(true)
    }
  })
})
