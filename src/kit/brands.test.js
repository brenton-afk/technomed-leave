import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { brandFor } from './brands.js'

describe('the maker and picture on a kit tile', () => {
  it('knows the makers, with a logo where a guide has one', () => {
    expect(brandFor('Mariner')).toMatchObject({ maker: 'SeaSpine', pic: '/kit-art/mariner.jpg', logo: '' })
    expect(brandFor('Shoreline')).toMatchObject({ maker: 'SeaSpine', pic: '/kit-art/shoreline.jpg' })
    expect(brandFor('Dakota')).toMatchObject({ maker: 'Precision Spine', logo: '/kit-art/logo-precision-spine.png' })
    expect(brandFor('Global BMD PLIF')).toMatchObject({ maker: 'Global Biomedica' })
    expect(brandFor('CYLOX')).toMatchObject({ maker: 'SIGNUS', pic: '' })
    expect(brandFor('TM Corpectomy')).toMatchObject({ maker: 'TechnoMed', initial: 'C' })
    expect(brandFor('Something new')).toMatchObject({ maker: '', pic: '', initial: 'S' })
  })
  it('every picture and logo named is in public/kit-art', () => {
    for (const s of ['Mariner', 'Mariner Outrigger', 'Shoreline', 'Fathom', 'Diplomat', 'Athlet', 'Dakota', 'Reform Cervical', 'Global BMD PLIF', 'Lonestar', 'Nuvasive', 'Brainlab']) {
      const b = brandFor(s)
      for (const f of [b.pic, b.logo].filter(Boolean)) expect(existsSync(`public${f}`), f).toBe(true)
    }
  })
})
