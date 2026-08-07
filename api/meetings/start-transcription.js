// AssemblyAI can fetch audio directly from any public URL, so once the
// recording is sitting in Vercel Blob storage we just hand over that URL —
// no audio ever passes through this function.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { audioUrl } = req.body
  if (!audioUrl) return res.status(400).json({ error: 'audioUrl is required' })

  const apiKey = process.env.ASSEMBLYAI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY not configured' })

  try {
    const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ audio_url: audioUrl, speaker_labels: true })
    })
    if (!transcriptRes.ok) {
      const errText = await transcriptRes.text()
      throw new Error(`AssemblyAI request failed (${transcriptRes.status}): ${errText}`)
    }
    const { id } = await transcriptRes.json()
    return res.status(200).json({ transcriptId: id })
  } catch (err) {
    console.error('start-transcription error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
