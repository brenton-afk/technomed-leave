// ─── Which kits have a consignment agreement (Brent, 11 Nov 2026) ───────────
// "The TM Loan sets don't require consignment agreements as they are Loan
// kits. Just tray lists for these kits." A TM loan kit is the `floating` kind
// (see seedKits in api/_kits.js): it goes where a case needs it rather than
// living on a hospital's shelf under an agreement. Shared by the screen and
// the server, so the tile, the kit's documents and the one-pass attach agree.

export const needsAgreement = kit => (kit?.kind || 'consignment') !== 'floating'
