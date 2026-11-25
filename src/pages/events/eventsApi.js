// Organiser calls to api/guides.js?events=… (Events, 25 Nov 2026).

export function eventsApi(token) {
  const headers = { Authorization: `Bearer ${token}` }
  const go = async (what, { query = {}, body } = {}) => {
    const qs = new URLSearchParams({ events: what, ...query }).toString()
    const res = await fetch(`/api/guides?${qs}`, body
      ? { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { headers })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `That did not work (${res.status})`)
    return data
  }
  return {
    access: () => fetch('/api/guides?events=access', { headers }).then(r => r.ok).catch(() => false),
    list: () => go('list'),
    get: id => go('get', { query: { id } }),
    save: event => go('save', { body: event }),
    remove: id => go('delete', { body: { id } }),
    addGuests: (id, contactIds, people = []) => go('guests-add', { body: { id, contactIds, people } }),
    guest: (id, token, change) => go('guest', { body: { id, token, change } }),
    send: (id, opts) => go('send', { body: { id, ...opts } }),
    invite: (id, file) => go('invite', { body: { id, ...file } }),
    inviteLink: id => go('invite-link', { query: { id } }),
    contacts: () => go('contacts'),
    saveContact: contact => go('contact-save', { body: { contact } }),
    removeContact: contactId => go('contact-remove', { body: { contactId } }),
    importContacts: (contacts, source) => go('contacts-import', { body: { contacts, source } }),
    phoneMobiles: updates => go('contacts-phone', { body: { updates } }),
    csvUrl: (id, which) => `/api/guides?events=${which}.csv&id=${encodeURIComponent(id)}`,
    download: async (id, which) => {
      const res = await fetch(`/api/guides?events=${which}.csv&id=${encodeURIComponent(id)}`, { headers })
      if (!res.ok) throw new Error('Could not download that')
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url; a.download = which === 'venue' ? 'Venue sheet.csv' : 'Hospitality record.csv'
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    }
  }
}

/** A picture shrunk to ~2000px JPEG, or a PDF as it is, as base64 for upload. */
export async function readInviteFile(file) {
  if (file.type === 'application/pdf') {
    const buf = new Uint8Array(await file.arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    return { base64: btoa(bin), contentType: 'application/pdf' }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url })
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale)
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    const data = canvas.toDataURL('image/jpeg', 0.88)
    return { base64: data.split(',')[1], contentType: 'image/jpeg' }
  } finally { URL.revokeObjectURL(url) }
}
