import cors from 'cors'
import 'dotenv/config'
import express from 'express'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import multer from 'multer'
import type { Recording, TranscriptUtterance, TranscriptWord } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const dataDir = path.join(rootDir, 'data')
const uploadDir = path.join(rootDir, 'uploads')
const dbPath = path.join(dataDir, 'recordings.json')
const port = Number(process.env.PORT ?? 8787)

await fs.mkdir(dataDir, { recursive: true })
await fs.mkdir(uploadDir, { recursive: true })

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 250 * 1024 * 1024,
  },
})

const app = express()
app.use(cors())
app.use(express.json())
app.use('/uploads', express.static(uploadDir))

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasDeepgramKey: Boolean(process.env.DEEPGRAM_API_KEY),
  })
})

app.get('/api/recordings', async (_req, res, next) => {
  try {
    const recordings = await readRecordings()
    res.json(recordings)
  } catch (error) {
    next(error)
  }
})

app.post('/api/recordings', upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ message: '音声ファイルがありません。' })
      return
    }

    const apiKey = process.env.DEEPGRAM_API_KEY
    if (!apiKey) {
      res.status(500).json({
        message: '.env に DEEPGRAM_API_KEY を設定してください。',
      })
      return
    }

    const originalName = req.file.originalname || 'recording.webm'
    const extension = path.extname(originalName) || extensionFromMime(req.file.mimetype)
    const storedName = `${randomUUID()}${extension}`
    const storedPath = path.join(uploadDir, storedName)
    await fs.rename(req.file.path, storedPath)

    const audioBytes = await fs.readFile(storedPath)
    const deepgram = await transcribeWithDeepgram({
      apiKey,
      audioBytes,
      mimeType: req.file.mimetype || 'application/octet-stream',
    })

    const normalized = normalizeDeepgram(deepgram)
    const createdAt = new Date().toISOString()
    const recording: Recording = {
      id: randomUUID(),
      title: makeTitle(normalized.transcriptText, originalName),
      filename: originalName,
      mimeType: req.file.mimetype,
      durationSeconds: normalized.durationSeconds,
      createdAt,
      status: 'processed',
      audioUrl: `/uploads/${storedName}`,
      transcriptText: normalized.transcriptText,
      utterances: normalized.utterances,
      words: normalized.words,
      rawDeepgram: deepgram,
    }

    const recordings = await readRecordings()
    recordings.unshift(recording)
    await writeRecordings(recordings)
    res.status(201).json(recording)
  } catch (error) {
    next(error)
  }
})

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  void next
  console.error(error)
  const message = error instanceof Error ? error.message : '予期しないエラーが起きました。'
  res.status(500).json({ message })
})

app.listen(port, () => {
  console.log(`API server running on http://localhost:${port}`)
})

async function readRecordings(): Promise<Recording[]> {
  try {
    const content = await fs.readFile(dbPath, 'utf8')
    return JSON.parse(content) as Recording[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

async function writeRecordings(recordings: Recording[]) {
  await fs.writeFile(dbPath, JSON.stringify(recordings, null, 2))
}

async function transcribeWithDeepgram({
  apiKey,
  audioBytes,
  mimeType,
}: {
  apiKey: string
  audioBytes: Buffer
  mimeType: string
}) {
  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'ja',
    smart_format: 'true',
    diarize: 'true',
    utterances: 'true',
  })

  const response = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': mimeType,
    },
    body: audioBytes,
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Deepgram API error (${response.status}): ${detail}`)
  }

  return response.json()
}

function normalizeDeepgram(payload: unknown) {
  const root = payload as {
    metadata?: { duration?: number }
    results?: {
      utterances?: Array<{
        speaker?: number
        start?: number
        end?: number
        transcript?: string
        words?: DeepgramWord[]
      }>
      channels?: Array<{
        alternatives?: Array<{
          transcript?: string
          words?: DeepgramWord[]
        }>
      }>
    }
  }

  const alternative = root.results?.channels?.[0]?.alternatives?.[0]
  const utterances: TranscriptUtterance[] = (root.results?.utterances ?? []).map((utterance) => ({
    speaker: typeof utterance.speaker === 'number' ? utterance.speaker : null,
    start: numberOrZero(utterance.start),
    end: numberOrZero(utterance.end),
    transcript: utterance.transcript ?? '',
    words: (utterance.words ?? []).map(normalizeWord),
  }))

  const words = alternative?.words?.map(normalizeWord) ?? utterances.flatMap((utterance) => utterance.words)
  const transcriptText =
    alternative?.transcript || utterances.map((utterance) => utterance.transcript).join('\n') || ''

  return {
    durationSeconds: typeof root.metadata?.duration === 'number' ? root.metadata.duration : null,
    transcriptText,
    utterances,
    words,
  }
}

type DeepgramWord = {
  word?: string
  punctuated_word?: string
  start?: number
  end?: number
  speaker?: number
  confidence?: number
}

function normalizeWord(word: DeepgramWord): TranscriptWord {
  return {
    word: word.word ?? '',
    punctuatedWord: word.punctuated_word ?? word.word ?? '',
    start: numberOrZero(word.start),
    end: numberOrZero(word.end),
    speaker: typeof word.speaker === 'number' ? word.speaker : null,
    confidence: typeof word.confidence === 'number' ? word.confidence : null,
  }
}

function numberOrZero(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function makeTitle(transcript: string, fallback: string) {
  const compact = transcript.replace(/\s+/g, ' ').trim()
  if (!compact) {
    return fallback
  }
  return compact.length > 34 ? `${compact.slice(0, 34)}...` : compact
}

function extensionFromMime(mimeType: string) {
  if (mimeType.includes('webm')) return '.webm'
  if (mimeType.includes('mp4')) return '.mp4'
  if (mimeType.includes('mpeg')) return '.mp3'
  if (mimeType.includes('wav')) return '.wav'
  if (mimeType.includes('m4a')) return '.m4a'
  return '.audio'
}
