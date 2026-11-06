// Starting a Xero connection needs an admin session, and a plain link cannot
// carry one — so the screen asks for the Xero address with its token, then
// goes there itself (api/xero/connect.js).
export async function connectXero(token, { invoices = false } = {}, fetcher = globalThis.fetch) {
  const res = await fetcher(`/api/xero/connect${invoices ? '?invoices=1' : ''}`, {
    headers: { Authorization: `Bearer ${token || ''}` }
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) throw new Error(data.error || 'Could not start the Xero connection')
  window.location.assign(data.url)
}
