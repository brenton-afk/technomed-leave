import { channelIds, getMessages, knownChannels } from './_redis.js'
import { dropboxConfigured, ensureFolder, uploadFile, downloadFile } from './_dropbox.js'
import { chatFileKey, chatFilePath } from './_chatFiles.js'
import { todayStr, TZ } from '../src/clinicalPlan/week.js'

// ─── The chat archive (Brent, 6 Nov 2026) ────────────────────────────────────
// "This is health data for the purposes of running our business and thus ok
// for us to store in a safe way. Ideally it would archive somewhere safe."
//
// Every night, each channel's messages from the day before go to Dropbox as a
// plain transcript, with every photo and file copied beside it — so the record
// does not depend on the chat's own store (which keeps the newest 500 per
// channel) or on the blob links staying up:
//   /Admin/Chat Archive/{YYYY}/{MM}/{YYYY-MM-DD}/{channel}.txt
//   /Admin/Chat Archive/{YYYY}/{MM}/{YYYY-MM-DD}/files/{time} {name}
// Re-running a day overwrites that day's files with the same content.

export const ARCHIVE_ROOT = process.env.CHAT_ARCHIVE_ROOT || '/Admin/Chat Archive'

const dayOf = iso => todayStr(new Date(iso), TZ)
const hhmm = iso => new Date(iso).toLocaleTimeString('en-AU', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
const safe = s => String(s || '').replace(/[\\/:*?"<>|]/g, '-').slice(0, 100)

/** One day of one channel as a transcript a person can read. */
export function transcript(channel, messages) {
  const lines = [`# ${channel}`, '']
  for (const m of messages) {
    const at = hhmm(m.at)
    const reply = m.replyTo ? ` (replying to ${m.replyTo.authorName}: "${m.replyTo.text}")` : ''
    const body = m.deleted ? '[deleted]' : (m.text || '')
    lines.push(`[${at}] ${m.authorName}${reply}: ${body}`)
    for (const f of [...(m.photo?.url ? [{ name: 'photo.jpg', url: m.photo.url }] : []), ...(m.files || [])]) {
      lines.push(`    attached: ${f.name} → files/${safe(`${at.replace(':', '')} ${f.name}`)}`)
    }
    const reacts = Object.entries(m.reactions || {}).map(([e, p]) => `${e} ${p.join(', ')}`).join('  ')
    if (reacts) lines.push(`    reactions: ${reacts}`)
  }
  return `${lines.join('\n')}\n`
}

export async function archiveChat(day, { fetcher = globalThis.fetch } = {}) {
  if (!dropboxConfigured()) return { skipped: 'Dropbox is not connected' }
  const [y, mo] = day.split('-')
  const folder = `${ARCHIVE_ROOT}/${y}/${mo}/${day}`
  const channels = await knownChannels()
  const done = []
  for (const channel of channels) {
    const messages = (await getMessages(await channelIds(channel)))
      .filter(m => m && dayOf(m.at) === day)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    if (!messages.length) continue
    await ensureFolder(folder)
    await uploadFile(`${folder}/${safe(channel)}.txt`, Buffer.from(transcript(channel, messages), 'utf8'))
    let files = 0
    for (const m of messages) {
      if (m.deleted) continue
      for (const f of [...(m.photo?.url ? [{ name: 'photo.jpg', url: m.photo.url }] : []), ...(m.files || [])]) {
        try {
          // A file the portal keeps in Dropbox is copied from there.
          const key = chatFileKey(f.url)
          let data
          if (key) data = await downloadFile(chatFilePath(key))
          else {
            const r = await fetcher(f.url)
            if (!r.ok) continue
            data = Buffer.from(await r.arrayBuffer())
          }
          await uploadFile(`${folder}/files/${safe(`${hhmm(m.at).replace(':', '')} ${f.name}`)}`, data)
          files += 1
        } catch { /* one file that will not copy does not stop the day */ }
      }
    }
    done.push({ channel, messages: messages.length, files })
  }
  return { day, folder, channels: done }
}
