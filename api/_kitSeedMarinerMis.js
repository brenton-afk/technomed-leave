// The Mariner MIS consignment set at Calvary (Brent, 21 Nov 2026: "We have
// just added a Mariner consignment kit to Calvary … extract the images and
// data and enter it into the portal under the Mariner tab for Calvary").
// Read from Appendix 1 of the consignment agreement with Calvary: seven trays,
// each with its photograph (numbers on the photo are the "#" in each line).
// Codes, descriptions and quantities only — the agreement's prices are not
// kept here. Applied once by KIT_CORRECTIONS in _kits.js; the photos are in
// _kitSeedMarinerMisPhotos.js, loaded only when it runs.

const m = (ref, code, description, qty) => ({ code, description: ref ? `#${ref} ${description}` : description, qty, kind: 'instrument' })
const i = (ref, code, description, qty) => ({ ...m(ref, code, description, qty), kind: 'implant' })

export const MARINER_MIS_KIT = {
  id: 'mariner-mis-clv', name: 'Mariner MIS', system: 'Mariner',
  distributor: 'device', kind: 'consignment', home: 'CLV'
}

export const MARINER_MIS_FILE = 'CONSIGNMENT AGREEMENT CLV - Device Technologies Seaspine Mariner MIS.pdf'

export const MARINER_MIS_TRAYS = [
  { name: 'Mariner MIS Insertion', photo: 1, lines: [
    m(1, 'MM2-100190', 'Screwdriver Navigated', 2),
    m(2, 'MM2-107850', 'Tap Cannulated 8.5mm', 1),
    m(3, 'MM2-107750', 'Tap Cannulated 7.5mm', 1),
    m(4, 'MM2-107650', 'Tap Cannulated 6.5mm', 1),
    m(5, 'MM2-107550', 'Tap Cannulated 5.5mm', 1),
    m(6, 'MM2-107450', 'Tap Cannulated 4.5mm', 1),
    m(7, 'MM2-100355', 'Head Remover', 1),
    m(8, 'MM2-100500', 'Screw Shank Adjuster', 1),
    m(9, 'MM2-000230', 'Fascial Splitter (2 parts)', 1),
    m(10, 'MM2-000540', 'Egg Handle Ratcheting', 2),
    m(11, 'MO-MOP-0249', 'Adapter Brainlab Navigation', 2),
    m(12, 'MM3-1000023', 'Fascial Blade Caddy', 1),
    m(13, 'MM2-000231', 'Fascial Blade', 4)
  ] },
  { name: 'Mariner MIS Torque and Reduction', photo: 2, lines: [
    m(1, '90-082', 'T-Handle Ratcheting', 1),
    m(2, 'MM2-100360', 'Final Torque Driver', 2),
    m(3, 'MM2-100390', 'Tower Attachment Tool', 1),
    m(4, 'MD2-004105', 'Adapter Torque Limiting', 1),
    m(5, 'MM2-100260', 'Rod Caliper', 1),
    m(6, 'MM2-100530', 'Tab Clipper', 1),
    m(7, 'MM2-100270', 'Rod Inserter MIS', 2),
    m(8, 'MM2-100510', 'Head Adjuster (Wrench)', 1),
    m(9, 'MM2-100400', 'Set Screwdriver Locking', 2),
    m(10, 'MM2-100353', 'Counter Torque Dual End', 1)
  ] },
  { name: 'Mariner MIS Screws', photo: 3, lines: [
    ...[[30, 4], [35, 8], [40, 8], [45, 8], [50, 4]]
      .map(([l, q]) => i(1, `SEA-MF1-2550${l}`, `Fenestrated Cannulated Screw 5.5 x ${l}mm`, q)),
    ...[[30, 4], [35, 8], [40, 12], [45, 12], [50, 12], [55, 8], [60, 4]]
      .map(([l, q]) => i(1, `SEA-MF1-2650${l}`, `Fenestrated Cannulated Screw 6.5 x ${l}mm`, q)),
    ...[[30, 4], [35, 4], [40, 8], [45, 8], [50, 8], [55, 4], [60, 4]]
      .map(([l, q]) => i(1, `SEA-MF1-2750${l}`, `Fenestrated Cannulated Screw 7.5 x ${l}mm`, q)),
    ...[[35, 4], [40, 4], [45, 4], [50, 4], [55, 2], [60, 2]]
      .map(([l, q]) => i(1, `SEA-MF1-2850${l}`, `Fenestrated Cannulated Screw 8.5 x ${l}mm`, q))
  ] },
  { name: 'Mariner MIS Rods, Tulips and Set Screws', photo: 4, lines: [
    ...[30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100, 110, 120]
      .map(l => i(1, `SEA-MM1-155${String(l).padStart(3, '0')}`, `MIS Precontoured Rod 5.5 x ${l}mm`, 2)),
    i(2, 'SEA-MD1-100016', 'Set Screw Point Lock', 20),
    i(3, 'SEA-41-7010', 'Trauma Head', 4),
    i(4, 'SEA-41-5010', 'Deformity Head', 4),
    i(5, 'SEA-41-3010', 'Polyaxial Head', 16),
    i(6, 'SEA-MM1-000020', 'MIS Polyaxial Head', 16),
    i(7, 'SEA-MM1-165250', 'MIS Straight Rod 5.5 x 250mm', 3),
    i(8, 'SEA-MM1-165450', 'MIS Straight Rod 5.5 x 450mm', 3),
    m(9, '90-0500', 'Rod Bender', 1),
    i(0, 'SEA-MM2-100050', 'Guidewire (located under, not pictured)', 12)
  ] },
  { name: 'Mariner MIS Reduction Towers', photo: 5, lines: [
    m(1, 'MM2-100342', 'Reducer Multi Driver', 2),
    m(2, 'MM2-000310', 'Tower Reducer', 4),
    m(3, 'MM2-100381', 'Manual Tower Remover', 1),
    m(4, 'MM2-100170', 'Snap Tower', 8)
  ] },
  { name: 'Mariner MIS Compressor Distractor DNO', photo: 6, lines: [
    m(1, 'MM2-100520', 'CD Main Arm', 1),
    m(2, 'MM2-100430', 'CD Extended Tab Arm', 1),
    m(3, 'MM2-100420', 'Tower Arm', 1),
    m(4, 'MM2-000460', 'Distractor MIS', 1),
    m(5, 'MM2-000490', 'Free Fulcrum', 1),
    m(6, 'MM2-000440', 'Compressor MIS', 1),
    m(7, 'MM2-100220', 'CD Driver', 1)
  ] },
  { name: 'Mariner MIS Dilator DNO', photo: 7, lines: [
    m(1, 'MM2-100160', 'Tap Sleeve', 2),
    m(2, 'MM2-100130', 'Dilator 1¼" Square', 1),
    m(3, 'MM2-100110', 'Dilator 1', 1),
    m(4, 'MM2-100410', 'Rod Confirmation', 1),
    m(5, 'MM2-100300', 'Rod Holder Wiltse', 1),
    m(6, 'MM2-107650', 'Dilator 3', 2),
    m(7, 'MM2-000450', 'K-Wire Driver', 1),
    m(8, 'MM2-000340', 'Reducer Driver', 2),
    m(9, 'MM2-100140', 'Dilator 2', 1)
  ] }
]
