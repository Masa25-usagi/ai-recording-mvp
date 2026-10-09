export type TranscriptWord = {
  word: string
  punctuatedWord: string
  start: number
  end: number
  speaker: number | null
  confidence: number | null
}

export type TranscriptUtterance = {
  speaker: number | null
  start: number
  end: number
  transcript: string
  words: TranscriptWord[]
}

export type Recording = {
  id: string
  title: string
  filename: string
  mimeType: string
  durationSeconds: number | null
  createdAt: string
  status: 'processed'
  audioUrl: string
  transcriptText: string
  utterances: TranscriptUtterance[]
  words: TranscriptWord[]
  rawDeepgram: unknown
}
