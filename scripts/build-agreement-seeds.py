#!/usr/bin/env python3
"""Builds api/_kitAgreementData.js and api/_kitAgreementPhotos_<doc>.js from the
consignment agreements read into trays.json files (Brent, 21 Nov 2026).

  python3 -I scripts/build-agreement-seeds.py <work dir>

Codes, descriptions and quantities only: any line or name that looks like a
price stops the build. Photos are shrunk to 900 px, JPEG 62."""
import base64, io, json, re, sys
from pathlib import Path
from PIL import Image

work = Path(sys.argv[1])
repo = Path(__file__).resolve().parent.parent
ROOT = '/Admin/Consignment Agreements'
CLV = f'{ROOT}/Calvary Lenah Valley Consignmnet Agreements'
RHH = f'{ROOT}/RHH Consignment Agreements'
# Signed where we have it, else the latest draft (Brent: unsigned is fine).
PATHS = {
  'clv-outrigger': f'{CLV}/Executed/CONSIGNMENT AGREEMENT CLV - SeaSpine Outrigger Connector Set Instruments & Implants (SIGNED).pdf',
  'clv-global-plif': f'{CLV}/Executed/CONSIGNMENT AGREEMENT CLV - E4 Surgical Global BMD PLIF SETS (SIGNED).pdf',
  'clv-cylox': f'{CLV}/Executed/CONSIGNMENT AGREEMENT CLV - Signus Cylox ACDF INSTRUMENTS & IMPLANTS (SIGNED).pdf',
  'clv-mobis': f'{CLV}/Executed/CONSIGNMENT AGREEMENT CLV - MOBIS Consignment Agreement (SIGNED).pdf',
  'clv-dakota': f'{CLV}/PDF format Consignment Agreement/CONSIGNMENT AGREEMENT CLV - E4 Dakota ACDF 2024.pdf',
  'clv-corpectomy': f'{CLV}/Executed/CONSIGNMENT AGREEMENT CLV - Technomed Corpetomy Set (SIGNED).pdf',
  'clv-screw-removal': f'{CLV}/Executed/CONSIGNMENT AGREEMENT CLV - Technomed Screw Removal Set (SIGNED).pdf',
  'clv-diplomat': f'{CLV}/Docx format Consignment Agreement/CONSIGNMENT AGREEMENT CLV - TM DIPLOMAT 2022.docx',
  'clv-diplomat-ibbett': f'{CLV}/PDF format Consignment Agreement/CONSIGNMENT AGREEMENT CLV - Signus Diplomat Ibbett Customs 2023.pdf',
  'clv-newclip': f'{CLV}/PDF format Consignment Agreement/CONSIGNMENT AGREEMENT CLV - NewClip Trans-Articular Screw 2026.pdf',
  'clv-ar300': f'{CLV}/PDF format Consignment Agreement/CONSIGNMENT AGREEMENT CLV - TM AR300 2026.pdf',
  'clv-shoreline': f'{CLV}/Docx format Consignment Agreement/CONSIGNMENT AGREEMENT CLV - TM SHORELINE 2026.docx',
  'clv-ascot': f'{CLV}/Docx format Consignment Agreement/CONSIGNMENT AGREEMENT CLV - TM ASCOT 2022.docx',
  'clv-locking-distractor': f'{CLV}/Docx format Consignment Agreement/CONSIGNMENT AGREEMENT CLV - Lock Distractor TechnoMed 2 2023.docx',
  'clv-cercess': f'{CLV}/Docx format Consignment Agreement/CONSIGNMENT AGREEMENT CLV - TM CERCESS 2022.docx',
  'rhh-mariner': f'{RHH}/PDF format Consignment Agreements/Device Technologies Seaspine Mariner Consignment Agreement TM-RHH 2026.pdf',
  'rhh-mariner-open': f'{RHH}/Awaiting Execution/Device Technologies Seaspine Mariner Consignment Agreement TM-RHH 2026 - OPEN UPDATE .pdf',
  'rhh-shoreline': f'{RHH}/Awaiting Execution/Device Technologies Shoreline Consignment Agreement TM-RHH 2026.pdf',
  'rhh-ascot': f'{RHH}/Awaiting Execution/Signus Ascot Consignment Agreement TM-RHH 2026.pdf',
  'rhh-boost': f'{RHH}/PDF format Consignment Agreements/Device Technologies BOOST UltraFibres Consignment Agreement TM-RHH 2024.pdf',
  'rhh-dakota': f'{RHH}/PDF format Consignment Agreements/E4 Surgical Dakota Consignment Agreement TM-RHH 2025.pdf',
  'rhh-reform': f'{RHH}/PDF format Consignment Agreements/E4 Surgical Reform POCT Consignment Agreement TM-RHH 2023.pdf',
  'rhh-athlet': f'{RHH}/PDF format Consignment Agreements/Signus Athlet Consignment Agreement TM-RHH 2024.pdf',
  'rhh-diplomat': f'{RHH}/PDF format Consignment Agreements/Signus Diplomat Consignment Agreement TM-RHH 2023.pdf',
  'rhh-nav-drills': f'{RHH}/PDF format Consignment Agreements/TechnoMed Fixed Navigated Drill Consignment Agreement TM-RHH 2024.pdf',
}
DIST = {'Diplomat': 'signus', 'CYLOX': 'signus', 'MOBIS': 'signus', 'Ascot': 'signus', 'Athlet': 'signus',
        'Global BMD PLIF': 'e4', 'Dakota': 'e4', 'Reform Cervical': 'e4',
        'Shoreline': 'device', 'Mariner': 'device', 'Mariner Outrigger': 'device', 'Boost UltraFibres': 'device'}
PRICE = re.compile(r'\$|\bAUD\b|\bprice\b', re.I)

out, loaders = [], []
for f in sorted(work.glob('*/trays.json')):
    d = json.loads(f.read_text())
    doc = d['doc']
    if doc not in PATHS: sys.exit(f'no agreement path for {doc}')
    photos = {}
    trays = []
    for t in d['trays']:
        lines = []
        for l in t['lines']:
            desc = (l.get('description') or '').strip()
            ref = str(l.get('ref') or '').strip()
            if ref and not desc.startswith('#'): desc = f'#{ref} {desc}'
            if PRICE.search(desc) or PRICE.search(l.get('code') or ''): sys.exit(f'price-like text in {doc}: {desc}')
            kind = 'implant' if l.get('kind') == 'implant' else 'instrument'
            qty = l.get('qty')
            qty = int(qty) if isinstance(qty, (int, float)) or str(qty).isdigit() else (0 if kind == 'implant' else 1)
            lines.append({'code': (l.get('code') or '').strip()[:40], 'description': desc[:120], 'qty': qty, 'kind': kind})
        key = None
        if t.get('photo'):
            src = f.parent / 'photos' / t['photo']
            im = Image.open(src).convert('RGB'); im.thumbnail((900, 900))
            buf = io.BytesIO(); im.save(buf, 'JPEG', quality=62)
            key = t['photo']; photos[key] = base64.b64encode(buf.getvalue()).decode()
        if lines:
            trays.append({'name': t['name'][:80], 'set': int(t.get('set') or 1), 'photo': key, 'lines': lines})
    path = PATHS[doc]
    out.append({'doc': doc, 'kit': d['kit'], 'hospital': d['hospital'], 'distributor': DIST.get(d['kit'], 'technomed' if d['kit'].startswith('TM ') else ''),
                'agreement': {'path': path, 'name': path.rsplit('/', 1)[1]}, 'trays': trays})
    if photos:
        (repo / f'api/_kitAgreementPhotos_{doc}.js').write_text(
            '// Tray photos from the consignment agreement (generated; see scripts/build-agreement-seeds.py).\n'
            'export const PHOTOS = ' + json.dumps(photos) + '\n')
        loaders.append(f"  '{doc}': () => import('./_kitAgreementPhotos_{doc}.js')")

head = ('// Generated by scripts/build-agreement-seeds.py from the consignment agreements\n'
        '// in Dropbox (Brent, 21 Nov 2026). Codes, descriptions and quantities only — no\n'
        '// prices. Photos are in _kitAgreementPhotos_*.js, loaded one agreement at a time.\n')
(repo / 'api/_kitAgreementData.js').write_text(head + 'export const AGREEMENTS = ' + json.dumps(out, indent=1) +
  '\n\nexport const PHOTO_LOADERS = {\n' + ',\n'.join(loaders) + '\n}\n')
for a in out:
    print(f"{a['doc']:24} {a['kit']:28} {a['hospital']} trays={len(a['trays'])} lines={sum(len(t['lines']) for t in a['trays'])} photos={sum(1 for t in a['trays'] if t['photo'])}")
