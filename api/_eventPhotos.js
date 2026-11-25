// ─── Photos for the Events page (Brent, 26 Nov 2026) ─────────────────────
// "Search some photos on Dropbox from our team and include these in the
// Events page … from the ten year anniversary party and other labs we have
// completed." Chosen by hand from the team's Dropbox and served from there —
// never copied into this repository, which is public. Lab photos are of the
// team and the room, never of a specimen or an operative field.
//
// Each is fetched as a Dropbox thumbnail (thumbnail in _dropbox.js) by
// `events=photo&id=…`, for people signed in to Events only. Only ids listed
// here are ever opened.

const PARTY = '/Education, Presentation & Events/10 Year Anniversary Party - September 2026/Professional photos'
const NEURO_ORTHO = '/Education, Presentation & Events/TM Education Events/NeuroOrtho Skills Lab May 2026/Photos Ortho Lab'
const ALIF = '/Education, Presentation & Events/TM Education Events/TM - ALIF Access Lab 6th and 7th September 2024/Photos'

export const ALBUMS = [
  { id: 'ten-years', title: '10 years of TechnoMed', when: 'September 2026', kind: 'dinner' },
  { id: 'alif-lab', title: 'ALIF Access Lab', when: 'September 2024', kind: 'workshop' },
  { id: 'neuro-ortho', title: 'NeuroOrtho Skills Lab', when: 'May 2026', kind: 'workshop' }
]

export const PHOTOS = [
  { id: 'party-0156', album: 'ten-years', path: `${PARTY}/TECHNOMED_2026_10YRS_0156.jpg`, caption: 'Ten years, on the big screen', hero: true },
  { id: 'party-0164', album: 'ten-years', path: `${PARTY}/TECHNOMED_2026_10YRS_0164.jpg`, caption: 'The team, celebrating', hero: true },
  { id: 'party-0095', album: 'ten-years', path: `${PARTY}/TECHNOMED_2026_10YRS_0095.jpg`, caption: 'On the terrace', hero: true },
  { id: 'party-0007', album: 'ten-years', path: `${PARTY}/TECHNOMED_2026_10YRS_0007.jpg`, caption: 'A decade of partnership' },
  { id: 'party-0177', album: 'ten-years', path: `${PARTY}/TECHNOMED_2026_10YRS_0177.jpg`, caption: 'A full room' },
  { id: 'party-0249', album: 'ten-years', path: `${PARTY}/TECHNOMED_2026_10YRS_0249.jpg`, caption: 'Friends of TechnoMed' },
  { id: 'party-0055', album: 'ten-years', path: `${PARTY}/TECHNOMED_2026_10YRS_0055.jpg`, caption: 'Sunset over the river' },
  { id: 'party-0284', album: 'ten-years', path: `${PARTY}/TECHNOMED_2026_10YRS_0284.jpg`, caption: 'Live music' },
  { id: 'alif-4651', album: 'alif-lab', path: `${ALIF}/IMG_4651.JPG`, caption: 'Faculty dinner and talks', hero: true },
  { id: 'alif-4662', album: 'alif-lab', path: `${ALIF}/IMG_4662.JPG`, caption: 'In the lab' },
  { id: 'alif-4658', album: 'alif-lab', path: `${ALIF}/IMG_4658.jpg`, caption: 'Hands-on, side by side' },
  { id: 'alif-4670', album: 'alif-lab', path: `${ALIF}/IMG_4670.JPG`, caption: 'Six stations running' },
  { id: 'neuro-0942', album: 'neuro-ortho', path: `${NEURO_ORTHO}/Photo 24-5-2026, 9 42 17 am.jpg`, caption: 'Registrars at work', hero: true },
  { id: 'neuro-0943', album: 'neuro-ortho', path: `${NEURO_ORTHO}/Photo 24-5-2026, 9 43 40 am.jpg`, caption: 'Set up and ready' },
  { id: 'neuro-0947', album: 'neuro-ortho', path: `${NEURO_ORTHO}/Photo 24-5-2026, 9 47 54 am.jpg`, caption: 'Teaching at the table' }
]

/** What the page is told: no Dropbox paths, only ids, captions and albums. */
export function gallery() {
  return {
    albums: ALBUMS,
    photos: PHOTOS.map(({ id, album, caption, hero }) => ({ id, album, caption, ...(hero ? { hero: true } : {}) }))
  }
}

export const photoById = id => PHOTOS.find(p => p.id === String(id || '')) || null
