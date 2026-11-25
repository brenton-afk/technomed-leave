// Label Studio's calls to the portal: api/guides.js?labels=… (admins only).

async function call(token, what, body) {
  const res = await fetch(`/api/guides?labels=${what}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token || ''}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `The portal answered ${res.status}`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

export const listLabels = token => call(token, 'list')
export const createLabel = (token, label) => call(token, 'create', { label })
export const saveLabel = (token, id, label, version, opts = {}) => call(token, 'save', { id, label, version, ...(opts.tidy ? { tidy: true } : {}) })
export const restoreLabel = (token, id) => call(token, 'restore', { id })
export const deleteLabel = (token, id) => call(token, 'delete', { id })
export const uploadLogo = (token, name, data) => call(token, 'logo', { name, data })

/** A picked file as a data URL, refused before upload when it is too big or not a picture. */
export function readLogoFile(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg)$/.test(file?.type || '')) return reject(new Error('Choose a PNG or JPEG picture'))
    if (file.size > 2 * 1024 * 1024) return reject(new Error('That picture is over 2 MB — make it smaller first'))
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('The picture could not be read'))
    r.readAsDataURL(file)
  })
}
