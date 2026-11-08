// ─── What the chat carries (shared by the phone and the server) ──────────────
// Brent, 8 Nov 2026: "The portal MUST be able to accept attachments. It needs
// to function seamlessly like WhatsApp." Pictures (GIFs included), video,
// PDFs, Office files, text, emails, zips — and anything a phone or PC cannot
// name still goes, as a file card (application/octet-stream).

export const FILE_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
  'image/svg+xml', 'image/bmp', 'image/tiff',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
  'audio/mpeg', 'audio/mp4', 'audio/x-m4a',
  'application/pdf', 'application/rtf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
  'message/rfc822', 'application/vnd.ms-outlook', 'application/zip', 'application/x-zip-compressed',
  'application/octet-stream'
]

const BY_EXTENSION = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', m4a: 'audio/x-m4a',
  pdf: 'application/pdf', rtf: 'application/rtf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', eml: 'message/rfc822', msg: 'application/vnd.ms-outlook', zip: 'application/zip'
}

/** The type a file will be stored as: its own if known, else by extension, else a plain file. */
export function fileTypeOf(file) {
  const given = String(file?.type || '').toLowerCase()
  if (FILE_TYPES.includes(given)) return given
  const ext = String(file?.name || '').split('.').pop().toLowerCase()
  return BY_EXTENSION[ext] || 'application/octet-stream'
}
