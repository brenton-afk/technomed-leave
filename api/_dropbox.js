// ─── Dropbox ──────────────────────────────────────────────────────────────────
// Writes the scan and usage sheet into the existing surgeon usage tree:
//   ALL SURGEON USAGE / SPINE / {SURGEON SURNAME} / {MONTH YEAR} / {FOLDER NAME}
// Folders are created on demand; an existing folder is added to, never replaced.

const ROOT = '/ALL SURGEON USAGE/SPINE'

export function dropboxConfigured() {
  return Boolean(process.env.DROPBOX_ACCESS_TOKEN)
}

function token() {
  const t = process.env.DROPBOX_ACCESS_TOKEN
  if (!t) throw new Error('DROPBOX_ACCESS_TOKEN not configured')
  return t
}

// Dropbox rejects most punctuation in paths and treats a trailing space as a
// different name, so each segment is trimmed and sanitised.
function segment(value) {
  return String(value == null ? '' : value)
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function caseFolderPath({ surgeonSurname, monthFolder, folderName }) {
  const parts = [segment(surgeonSurname), segment(monthFolder), segment(folderName)]
  if (parts.some(p => !p)) {
    throw new Error('Cannot build a Dropbox path without surgeon, month and folder name')
  }
  return `${ROOT}/${parts.join('/')}`
}

async function rpc(endpoint, body) {
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { /* non-JSON error body */ }
  return { ok: res.ok, status: res.status, data, text }
}

// Creates every missing level of the path. A folder that already exists is a
// success, not an error — reps commonly add a second sheet to an existing case.
export async function ensureFolder(path) {
  const segments = path.split('/').filter(Boolean)
  let current = ''
  for (const seg of segments) {
    current += `/${seg}`
    const { ok, data, status, text } = await rpc('files/create_folder_v2', {
      path: current,
      autorename: false
    })
    if (ok) continue
    const tag = data?.error?.path?.['.tag'] || data?.error_summary || ''
    if (String(tag).includes('conflict')) continue // already there
    throw new Error(`Dropbox could not create "${current}" (${status}): ${data?.error_summary || text}`)
  }
  return path
}

export async function uploadFile(path, buffer) {
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/octet-stream',
      // `overwrite` keeps a re-run from littering the folder with (1) copies.
      'Dropbox-API-Arg': JSON.stringify({
        path,
        mode: 'overwrite',
        autorename: false,
        mute: true,
        strict_conflict: false
      })
    },
    body: buffer
  })
  const text = await res.text()
  if (!res.ok) {
    let summary = text
    try { summary = JSON.parse(text).error_summary || text } catch { /* keep raw */ }
    throw new Error(`Dropbox upload failed for "${path.split('/').pop()}" (${res.status}): ${summary}`)
  }
  try { return JSON.parse(text) } catch { return { path_display: path } }
}

export async function saveUsageFiles({ folderPath, folderName, scanPdf, usageSheet }) {
  await ensureFolder(folderPath)

  const saved = []
  if (scanPdf) {
    const name = `${folderName}_Usage_Scan.pdf`
    await uploadFile(`${folderPath}/${name}`, scanPdf)
    saved.push(name)
  }
  if (usageSheet) {
    const name = `${folderName}_Usage_Sheet.xlsx`
    await uploadFile(`${folderPath}/${name}`, usageSheet)
    saved.push(name)
  }
  return { folderPath, saved }
}
