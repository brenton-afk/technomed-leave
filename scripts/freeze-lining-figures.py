# Bakes Cormorant Garamond's lining figures (its OpenType 'lnum' feature)
# into the label font files, so 0–9 draw as lining numerals everywhere —
# canvas (the 600 dpi print, Fabric) cannot switch an OpenType feature on.
# Label Studio, 25 Nov 2026: REF lines set in Borges Titulo (now Cormorant)
# had old-style digits dipping below the line.
#
#   pip install fonttools brotli
#   python3 scripts/freeze-lining-figures.py public/fonts/labels/cormorant-garamond-latin-*.woff2
#
# Rewrites each file in place; running it twice changes nothing more.

import sys
from fontTools.ttLib import TTFont


def freeze(path, feature='lnum'):
    font = TTFont(path)
    gsub = font['GSUB'].table
    indices = {i for fr in gsub.FeatureList.FeatureRecord if fr.FeatureTag == feature for i in fr.Feature.LookupListIndex}
    mapping = {}
    for i in sorted(indices):
        lookup = gsub.LookupList.Lookup[i]
        for sub in lookup.SubTable:
            if lookup.LookupType == 7:  # extension
                sub = sub.ExtSubTable
            if getattr(sub, 'mapping', None):
                mapping.update(sub.mapping)
    changed = 0
    for table in font['cmap'].tables:
        for code, glyph in list(table.cmap.items()):
            if glyph in mapping and mapping[glyph] != glyph:
                table.cmap[code] = mapping[glyph]
                changed += 1
    font.flavor = 'woff2'
    font.save(path)
    print(f'{path}: {changed} cmap entries now draw {feature} glyphs')


for p in sys.argv[1:]:
    freeze(p)
