// The label fonts, from this portal's own copy (public/fonts/labels, SIL Open
// Font Licence), added to the page with the FontFace API so the SVG previews,
// the Fabric editor and the 600 dpi print all draw with the same files. Only
// loaded when Label Studio opens — the rest of the portal never fetches them.

import { FONT_FILES } from './model.js'

let loading = null

export function loadLabelFonts() {
  if (loading) return loading
  if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) return (loading = Promise.resolve(false))
  const faces = []
  for (const [family, f] of Object.entries(FONT_FILES)) {
    const variants = [['400', 'normal']]
    if (f.bold) variants.push(['700', 'normal'])
    if (f.italic) variants.push(['400', 'italic'])
    if (f.bold && f.italic) variants.push(['700', 'italic'])
    for (const [weight, style] of variants) {
      const face = new FontFace(family, `url(/fonts/labels/${f.file}-latin-${weight}-${style}.woff2) format('woff2')`, { weight, style, display: 'block' })
      document.fonts.add(face)
      faces.push(face.load().catch(() => null))
    }
  }
  loading = Promise.all(faces).then(list => list.filter(Boolean).length > 0)
  return loading
}
