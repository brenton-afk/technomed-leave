// The browser polls this every few seconds after starting a transcription.
// AssemblyAI batch jobs typically take a fraction of the audio's real
// length to process (a 45-minute meeting usually finishes in well under
// 10 minutes), so a few seconds between polls is plenty.

export default async function handler(req, res) {
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'Missing transcript id' })

  const apiKey = process.env.ASSEMBLYAI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY not configured' })

  try {
    const r = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { authorization: apiKey }
    })
    const data = await r.json()

    if (data.status === 'error') {
      return res.status(200).json({ status: 'error', error: data.error })
    }
    if (data.status !== 'completed') {
      return res.status(200).json({ status: data.status })
    }

    const transcript = (data.utterances && data.utterances.length)
      ? data.utterances.map(u => `Speaker ${u.speaker}: ${u.text}`).join('\n')
      : data.text

    return res.status(200).json({ status: 'completed', transcript })
  } catch (err) {
    console.error('status error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
