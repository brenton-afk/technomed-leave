import { handleUpload } from '@vercel/blob/client'

// The phone uploads the recorded audio straight to Vercel Blob storage from
// the browser — it never passes through this function or through Vercel's
// request body limit. This route only ever handles a small JSON handshake:
// it issues a short-lived upload token, and (optionally) gets notified once
// the upload finishes. Requires Vercel Blob storage to be enabled on the
// project (Storage tab in the Vercel dashboard) — that provisions
// BLOB_READ_WRITE_TOKEN automatically.

export default async function handler(req, res) {
  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async () => {
        return {
          allowedContentTypes: ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/x-m4a'],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({})
        }
      },
      onUploadCompleted: async ({ blob }) => {
        console.log('Meeting audio uploaded:', blob.url)
      }
    })
    return res.status(200).json(jsonResponse)
  } catch (err) {
    console.error('Blob upload token error:', err.message)
    return res.status(400).json({ error: err.message })
  }
}
