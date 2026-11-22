// Who may open Admin → Stock on hand (preview). Brent alone by default
// (22 Nov 2026: "not visible by anyone else"); STOCK_PREVIEW_USERS widens it.
export function mayPreviewStock(email, env = process.env) {
  const list = String(env.STOCK_PREVIEW_USERS || 'brenton@technomed.com.au').toLowerCase().split(/[\s,]+/).filter(Boolean)
  return list.includes(String(email || '').toLowerCase())
}
