// ─── Dropbox ──────────────────────────────────────────────────────────────────
// Writes the scan and usage sheet into the existing surgeon usage tree:
//   ALL SURGEON USAGE / SPINE / {SURGEON SURNAME} / {MONTH YEAR} / {FOLDER NAME}
// Folders are created on demand; an existing folder is added to, never replaced.

import { parseFolderName } from './_usageCase.js'
import { redis } from './_redis.js'

const ROOT = '/ALL SURGEON USAGE/SPINE'

// ─── Connecting ──────────────────────────────────────────────────────────────
// Dropbox no longer issues access tokens that last: one pasted into an
// environment variable stops working after four hours. So the portal is
// connected the way Xero is — an admin taps Connect Dropbox, approves it once,
// and the long-lived refresh token is kept in Redis (`dropbox_rt`). Each call
// uses a short-lived access token minted from it and cached until just before
// it expires.
//
// The team's files live in the TECHNOMED team folder, so calls are made with
// that folder as their root (`dropbox_root`, found on connecting, or
// DROPBOX_ROOT_NAMESPACE). That is what makes "/ALL SURGEON USAGE/SPINE" and
// "/Tray Lists" mean /TECHNOMED/ALL SURGEON USAGE/SPINE and /TECHNOMED/Tray
// Lists.
//
// DROPBOX_ACCESS_TOKEN still works on its own, for a quick test.

export const DROPBOX_KEYS = { rt: 'dropbox_rt', at: 'dropbox_at', exp: 'dropbox_exp', root: 'dropbox_root', who: 'dropbox_who' }

function appCredentials() {
  const key = process.env.DROPBOX_APP_KEY
  const secret = process.env.DROPBOX_APP_SECRET
  return key && secret ? { key, secret } : null
}

export function dropboxConfigured() {
  return Boolean(process.env.DROPBOX_ACCESS_TOKEN || appCredentials())
}

async function accessToken() {
  const app = appCredentials()
  if (!app) {
    const t = process.env.DROPBOX_ACCESS_TOKEN
    if (!t) throw new Error('Dropbox is not set up')
    return t
  }
  const [rt, at, exp] = await Promise.all([
    redis('get', DROPBOX_KEYS.rt), redis('get', DROPBOX_KEYS.at), redis('get', DROPBOX_KEYS.exp)
  ])
  if (!rt) throw new Error('Dropbox needs connecting — Admin → System → Connect Dropbox')
  if (at && Number(exp) > Date.now() + 60000) return at
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: app.key, client_secret: app.secret })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    throw new Error('Dropbox has disconnected — reconnect it in Admin → System')
  }
  const until = Date.now() + Number(data.expires_in || 14400) * 1000
  await Promise.all([
    redis('set', DROPBOX_KEYS.at, data.access_token),
    redis('set', DROPBOX_KEYS.exp, String(until))
  ])
  return data.access_token
}

/** The headers every call carries: the token, and the team folder as root. */
async function authHeaders() {
  const headers = { Authorization: `Bearer ${await accessToken()}` }
  const root = process.env.DROPBOX_ROOT_NAMESPACE || (appCredentials() ? await redis('get', DROPBOX_KEYS.root) : null)
  if (root) headers['Dropbox-API-Path-Root'] = JSON.stringify({ '.tag': 'namespace_id', namespace_id: String(root) })
  return headers
}

/** The link an admin follows to connect the portal to Dropbox. */
export function dropboxConnectUrl(state, redirectUri) {
  const app = appCredentials()
  if (!app) throw new Error('DROPBOX_APP_KEY and DROPBOX_APP_SECRET are not set in Vercel')
  return 'https://www.dropbox.com/oauth2/authorize?' + new URLSearchParams({
    client_id: app.key, response_type: 'code', token_access_type: 'offline', redirect_uri: redirectUri, state
  })
}

/**
 * Finishes connecting: swaps the code for a refresh token, finds the
 * TECHNOMED team folder to use as the root, and records who connected it.
 */
export async function finishDropboxConnect(code, redirectUri) {
  const app = appCredentials()
  if (!app) throw new Error('Dropbox app keys are not set')
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, grant_type: 'authorization_code', client_id: app.key, client_secret: app.secret, redirect_uri: redirectUri })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.refresh_token) throw new Error(data.error_description || 'Dropbox did not return a connection')
  await Promise.all([
    redis('set', DROPBOX_KEYS.rt, data.refresh_token),
    redis('set', DROPBOX_KEYS.at, data.access_token),
    redis('set', DROPBOX_KEYS.exp, String(Date.now() + Number(data.expires_in || 14400) * 1000)),
    redis('del', DROPBOX_KEYS.root)
  ])
  const auth = { Authorization: `Bearer ${data.access_token}`, 'Content-Type': 'application/json' }
  const who = await fetch('https://api.dropboxapi.com/2/users/get_current_account', { method: 'POST', headers: { Authorization: auth.Authorization } })
    .then(r => r.json()).catch(() => ({}))
  // The TECHNOMED folder, looked up from the account's own root.
  let root = process.env.DROPBOX_ROOT_NAMESPACE || ''
  if (!root) {
    const home = who?.root_info?.root_namespace_id
    const meta = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
      method: 'POST',
      headers: { ...auth, ...(home ? { 'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: String(home) }) } : {}) },
      body: JSON.stringify({ path: '/TECHNOMED' })
    }).then(r => r.json()).catch(() => ({}))
    root = meta?.shared_folder_id || meta?.sharing_info?.shared_folder_id || ''
  }
  if (root) await redis('set', DROPBOX_KEYS.root, String(root))
  const name = who?.name?.display_name || who?.email || ''
  await redis('set', DROPBOX_KEYS.who, JSON.stringify({ name, at: new Date().toISOString(), root: root || null }))
  return { name, root: root || null }
}

export async function dropboxStatus() {
  const configured = dropboxConfigured()
  if (!appCredentials()) return { configured, connected: Boolean(process.env.DROPBOX_ACCESS_TOKEN), via: 'token' }
  const [rt, who] = await Promise.all([redis('get', DROPBOX_KEYS.rt), redis('get', DROPBOX_KEYS.who)])
  let info = {}
  try { info = who ? JSON.parse(who) : {} } catch { info = {} }
  return { configured, connected: Boolean(rt), by: info.name || '', at: info.at || '', teamFolder: Boolean(info.root), usageReads: usageReadsAllowed() }
}

// ─── The usage folders stay shut ─────────────────────────────────────────────
// "I just don't want you reading the Usage folders please unless under
// explicit instruction, until we have completed the redaction." — Brent,
// 2 Nov 2026. Filing a new usage form (a write) carries on; anything that
// would read what is already filed there is refused until
// DROPBOX_USAGE_READS is set to "on".

export function usageReadsAllowed() {
  return String(process.env.DROPBOX_USAGE_READS || '').toLowerCase() === 'on'
}

function assertUsageReadable(path) {
  const p = String(path || '').toLowerCase()
  const usage = '/all surgeon usage'
  if ((p === usage || p.startsWith(usage + '/')) && !usageReadsAllowed()) {
    const err = new Error('Filed usage is locked until the redaction is finished')
    err.code = 'locked'
    throw err
  }
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

// ─── Saying what went wrong without saying who it was about ──────────────────
// Every path in this tree has a patient's surname in it, and these messages do
// not stay here: agent.js logs err.message to Vercel, which retains it, and
// returns it to the browser. A failure interpolating the path would put
// surnames into an operations log on the first bad afternoon Dropbox has.
//
// So nothing identifying is ever built into one. What is left — the operation,
// the HTTP status and Dropbox's own error tag — is what actually diagnoses a
// fault anyway: "insufficient_space", "invalid_access_token", "not_found". The
// path adds nothing a developer needs and everything a patient would mind.
function dropboxFault(what, status, summary) {
  // Dropbox's error_summary is a tag like "path/not_found/..." and carries no
  // content of ours. The raw body might, so it is deliberately not included.
  const tag = String(summary || '').split('/')[0] || 'unknown'
  return new Error(`Dropbox could not ${what} (${status}): ${tag}`)
}

async function rpc(endpoint, body) {
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: {
      ...(await authHeaders()),
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
    throw dropboxFault('create a folder', status, data?.error_summary)
  }
  return path
}

/** One file's bytes (not under the locked usage tree). */
export async function downloadFile(path) {
  assertUsageReadable(path)
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Dropbox-API-Arg': JSON.stringify({ path }) }
  })
  if (!res.ok) {
    let summary = ''
    try { summary = JSON.parse(await res.text()).error_summary } catch { /* keep blank */ }
    throw dropboxFault('download a file', res.status, summary)
  }
  return Buffer.from(await res.arrayBuffer())
}

/**
 * `keep: true` never replaces a file already there: Dropbox adds " (1)" to the
 * new one instead. For documents that each matter (a second resupply for the
 * same case must not overwrite the first); re-runs of the same filing keep
 * the default overwrite.
 */
export async function uploadFile(path, buffer, { keep = false } = {}) {
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      ...(await authHeaders()),
      'Content-Type': 'application/octet-stream',
      // `overwrite` keeps a re-run from littering the folder with (1) copies.
      'Dropbox-API-Arg': JSON.stringify({
        path,
        mode: keep ? 'add' : 'overwrite',
        autorename: keep,
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
    throw dropboxFault('upload a file', res.status, summary)
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

// ─── Reading back ─────────────────────────────────────────────
// Lets the app browse what was filed, which is what makes a saved usage sheet
// reachable from the phone rather than only from Dropbox itself. Read-only.

const RESOURCES_ROOT = process.env.DROPBOX_RESOURCES_PATH || '/RESOURCES'

export function resourcesRoot() {
  return RESOURCES_ROOT
}

export function usageRoot() {
  return ROOT
}

/** Folders and files directly under `path`, folders first. */
/**
 * The case folders already filed for this patient on this day, by name only.
 *
 * Brent, 6 Nov 2026, after the Matthews double-up: "a check should be 'is
 * there already a folder in Dropbox?'". A deliberate, narrow exception to the
 * usage read lock: it lists one surgeon's month folder and returns only the
 * names that start `{Surname}_{DDMMYYYY}_` — never a file, never any content.
 * The procedure part of the name is left out of the match because it is what
 * differed between the two Matthews scans.
 */
export async function caseFoldersOnDay({ surgeonSurname, monthFolder, folderName }) {
  const prefix = String(folderName || '').split('_').slice(0, 2).join('_').toLowerCase()
  if (!surgeonSurname || !monthFolder || !/_\d{8}$/.test(prefix)) return []
  const { ok, data, text } = await rpc('files/list_folder', {
    path: `${ROOT}/${segment(surgeonSurname)}/${segment(monthFolder)}`,
    recursive: false,
    include_deleted: false,
    limit: 500
  })
  if (!ok) {
    if (String(data?.error_summary || text || '').includes('not_found')) return []
    throw dropboxFault('check for an existing case folder', 0, data?.error_summary)
  }
  return (data.entries || [])
    .filter(e => e['.tag'] === 'folder' && e.name.toLowerCase().startsWith(prefix + '_'))
    .map(e => e.name)
}

export async function listFolder(path) {
  assertUsageReadable(path)
  const { ok, data, status, text } = await rpc('files/list_folder', {
    path: path === '/' ? '' : path,
    recursive: false,
    include_deleted: false,
    include_non_downloadable_files: true,
    limit: 500
  })
  if (!ok) {
    const summary = data?.error_summary || text || ''
    // A folder that was never created is an empty folder as far as the UI cares.
    if (String(summary).includes('not_found')) return { entries: [], missing: true }
    throw dropboxFault('list a folder', status, summary)
  }

  const entries = (data.entries || []).map(e => ({
    kind: e['.tag'] === 'folder' ? 'folder' : 'file',
    name: e.name,
    path: e.path_lower || e.path_display,
    displayPath: e.path_display,
    size: e.size ?? null,
    modified: e.server_modified || null
  }))

  entries.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name, 'en-AU') : (a.kind === 'folder' ? -1 : 1))

  return { entries, missing: false }
}

/**
 * Every file under a folder, all the way down (the kit room's "Add from
 * Dropbox", 11 Nov 2026). Never the usage tree — the lock applies here too.
 * Capped, so a mistaken root cannot walk the whole account.
 */
export async function listFilesUnder(path, { max = 3000 } = {}) {
  assertUsageReadable(path)
  const files = []
  let res = await rpc('files/list_folder', { path, recursive: true, include_deleted: false, limit: 2000 })
  for (;;) {
    if (!res.ok) {
      const summary = res.data?.error_summary || res.text || ''
      if (String(summary).includes('not_found')) return files
      throw dropboxFault('list a folder', res.status, summary)
    }
    for (const e of res.data.entries || []) {
      if (e['.tag'] !== 'file') continue
      files.push({ name: e.name, path: e.path_display, size: e.size ?? 0, modified: e.server_modified || null, rev: e.rev || '' })
    }
    if (!res.data.has_more || files.length >= max) return files.slice(0, max)
    res = await rpc('files/list_folder/continue', { cursor: res.data.cursor })
  }
}

/**
 * A short-lived direct link to one file. Dropbox expires these after ~4 hours,
 * so they are fetched on demand and never stored — a persisted link would be a
 * public URL to patient data long after anyone remembered it existed.
 */
/**
 * A short-lived link to one file.
 *
 * `portalFiled` lets a file the portal filed itself through the usage lock —
 * the caller has already checked it against the portal's own record of what
 * it filed (see filedTree in api/usage/agent.js). Nothing else under the
 * usage tree is opened until the redaction is finished.
 */
export async function temporaryLink(path, { portalFiled = false } = {}) {
  if (!portalFiled) assertUsageReadable(path)
  const { ok, data, status, text } = await rpc('files/get_temporary_link', { path })
  if (!ok) {
    throw dropboxFault('open that file', status, data?.error_summary)
  }
  // `rev` changes whenever the file does, so a phone that kept a copy knows
  // whether it is still the current one (src/kit/docCache.js).
  return { url: data.link, name: data.metadata?.name || path.split('/').pop(), rev: data.metadata?.rev || '', size: data.metadata?.size || 0 }
}

/**
 * Folders under the usage tree whose name contains a surname.
 *
 * For answering "what has this patient already got in" before a revision or a
 * removal. The whole tree is searched, not just the booking's surgeon: most
 * patients come back to the same one, and the ones who do not — a Dubey patient
 * turning up on Thani's list with a Diplomat already in — are exactly the ones
 * that would otherwise be missed. Where it was filed is returned with it, so the
 * app can say which surgeon put it in.
 *
 * `files/search_v2` rather than walking the tree: years of surgeons, months and
 * cases is thousands of folders, and Dropbox will do the matching for nothing.
 */
export async function searchUsage(surname, { limit = 40 } = {}) {
  assertUsageReadable(ROOT)
  const query = String(surname || '').trim()
  if (!query) return []

  const { ok, data, status, text } = await rpc('files/search_v2', {
    query,
    options: {
      path: ROOT,
      max_results: Math.min(limit, 100),
      // Folders, because a case is a folder here and the files inside it repeat
      // the same name with a suffix.
      file_categories: [],
      filename_only: true
    }
  })
  if (!ok) {
    const summary = data?.error_summary || text || ''
    // A tree that is not there yet is not an error worth stopping a booking for.
    if (String(summary).includes('not_found')) return []
    throw dropboxFault('run that search', status, summary)
  }

  const seen = new Set()
  const out = []
  for (const match of data.matches || []) {
    const meta = match.metadata?.metadata || match.metadata
    if (!meta?.name) continue
    // Files inside a case folder carry the case's name plus a suffix, so the
    // folder and its two files would otherwise come back as three cases.
    const isFolder = meta['.tag'] === 'folder'
    const name = isFolder ? meta.name : meta.name.replace(/_(?:Usage_Sheet|Scan)\.\w+$/i, '')
    const path = meta.path_display || meta.path_lower || ''
    const key = `${name}|${path.split('/').slice(0, -1).join('/')}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, path })
  }
  return out
}

/**
 * Everything filed under a patient's surname, newest first.
 *
 * The question the admin team actually asks — "what has this patient had from
 * us, and when" — which the folder tree cannot answer on its own. The tree is
 * filed by surgeon and then by month, so a patient who saw Thani in 2024 and
 * Garg in 2026 is in two places years apart, and nobody finds the first one
 * while looking at the second.
 *
 * Each case comes back with its files, so the history is openable rather than
 * merely informative. The files are listed per case rather than searched for
 * separately: a search returns the folder and its contents as three matches,
 * and deduplicating them afterwards is guesswork where listing is certain.
 */
export async function patientHistory(surname, { limit = 25 } = {}) {
  assertUsageReadable(ROOT)
  const query = String(surname || '').trim()
  if (query.length < 2) return { cases: [], query }

  const folders = await searchUsage(query, { limit })
  const cases = []
  for (const folder of folders) {
    const parsed = parseFolderName(folder.name)
    // The search matches on the whole path, so a patient whose surname is also
    // a surgeon's — or part of a hospital's — would otherwise drag in every
    // case that surgeon ever did. The surname has to be the patient's.
    if (parsed.recognised
      && !parsed.patientSurname.toLowerCase().includes(query.toLowerCase())) continue

    let files = []
    try {
      const listed = await listFolder(folder.path)
      files = listed.entries.filter(e => e.kind === 'file')
    } catch {
      // A folder that will not list is still a case that happened. Saying so
      // with no files beats dropping it out of a clinical history.
      files = []
    }
    cases.push({ ...parsed, path: folder.path, name: folder.name, files })
  }

  // Newest first, and anything undated last rather than first — an unparsed
  // folder sorting to the top would push this year's cases off the screen.
  cases.sort((a, b) => {
    if (!a.date && !b.date) return a.name.localeCompare(b.name, 'en-AU')
    if (!a.date) return 1
    if (!b.date) return -1
    return b.date.localeCompare(a.date)
  })
  return { cases, query }
}
