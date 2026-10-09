import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type TranscriptWord = {
  word: string
  punctuatedWord: string
  start: number
  end: number
  speaker: number | null
  confidence: number | null
}

type TranscriptUtterance = {
  speaker: number | null
  start: number
  end: number
  transcript: string
  words: TranscriptWord[]
}

type Recording = {
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
}

function App() {
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState('')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const selectedRecording = useMemo(
    () => recordings.find((recording) => recording.id === selectedId) ?? recordings[0] ?? null,
    [recordings, selectedId],
  )

  useEffect(() => {
    async function loadRecordings() {
      const response = await fetch('/api/recordings')
      const data = (await response.json()) as Recording[]
      setRecordings(data)
      setSelectedId((current) => current ?? data[0]?.id ?? null)
    }

    void loadRecordings()
  }, [])

  async function uploadAudio(file: File) {
    setError('')
    setIsLoading(true)

    try {
      const form = new FormData()
      form.append('audio', file)

      const response = await fetch('/api/recordings', {
        method: 'POST',
        body: form,
      })

      if (!response.ok) {
        const detail = (await response.json()) as { message?: string }
        throw new Error(detail.message ?? '文字起こしに失敗しました。')
      }

      const recording = (await response.json()) as Recording
      setRecordings((current) => [recording, ...current])
      setSelectedId(recording.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'エラーが起きました。')
    } finally {
      setIsLoading(false)
    }
  }

  async function startRecording() {
    setError('')
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    chunksRef.current = []
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data)
      }
    }

    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop())
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      const file = new File([blob], `browser-recording-${Date.now()}.webm`, {
        type: 'audio/webm',
      })
      void uploadAudio(file)
    }

    recorder.start()
    setIsRecording(true)
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
  }

  function seekTo(seconds: number) {
    if (!audioRef.current) return
    audioRef.current.currentTime = seconds
    void audioRef.current.play()
  }

  return (
    <main className="app-shell">
      <section className="sidebar" aria-label="録音一覧">
        <div>
          <p className="eyebrow">AI Recording MVP</p>
          <h1>音声を録って、あとから読める形にする</h1>
        </div>

        <div className="actions">
          <button
            type="button"
            className={isRecording ? 'danger-button' : 'primary-button'}
            disabled={isLoading}
            onClick={isRecording ? stopRecording : startRecording}
          >
            {isRecording ? '録音を停止' : 'ブラウザで録音'}
          </button>

          <label className="file-button">
            音声ファイルを選ぶ
            <input
              type="file"
              accept="audio/*,video/mp4"
              disabled={isLoading || isRecording}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void uploadAudio(file)
                event.currentTarget.value = ''
              }}
            />
          </label>
        </div>

        {isLoading ? <p className="status">Deepgramで文字起こし中です。</p> : null}
        {error ? <p className="error">{error}</p> : null}

        <div className="recording-list">
          {recordings.length === 0 ? (
            <p className="empty">まだ録音がありません。短い音声でまず試してください。</p>
          ) : (
            recordings.map((recording) => (
              <button
                type="button"
                className={recording.id === selectedRecording?.id ? 'recording selected' : 'recording'}
                key={recording.id}
                onClick={() => setSelectedId(recording.id)}
              >
                <span>{recording.title}</span>
                <small>
                  {new Date(recording.createdAt).toLocaleString('ja-JP')} /{' '}
                  {formatDuration(recording.durationSeconds)}
                </small>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="workspace" aria-label="文字起こし詳細">
        {selectedRecording ? (
          <>
            <header className="detail-header">
              <div>
                <p className="muted">{selectedRecording.filename}</p>
                <h2>{selectedRecording.title}</h2>
              </div>
              <span className="processed">processed</span>
            </header>

            <audio ref={audioRef} src={selectedRecording.audioUrl} controls className="player" />

            <div className="transcript">
              {selectedRecording.utterances.length > 0 ? (
                selectedRecording.utterances.map((utterance, index) => (
                  <article className="utterance" key={`${utterance.start}-${index}`}>
                    <button
                      type="button"
                      className="speaker"
                      onClick={() => seekTo(utterance.start)}
                    >
                      話者 {utterance.speaker === null ? '?' : utterance.speaker + 1}
                      <span>{formatClock(utterance.start)}</span>
                    </button>
                    <p>
                      {utterance.words.length > 0
                        ? utterance.words.map((word, wordIndex) => (
                            <button
                              type="button"
                              className="word"
                              key={`${word.start}-${wordIndex}`}
                              onClick={() => seekTo(word.start)}
                              title={`${formatClock(word.start)} に移動`}
                            >
                              {word.punctuatedWord}
                            </button>
                          ))
                        : utterance.transcript}
                    </p>
                  </article>
                ))
              ) : (
                <p className="plain-transcript">{selectedRecording.transcriptText}</p>
              )}
            </div>
          </>
        ) : (
          <div className="welcome">
            <h2>最初の成果物</h2>
            <p>録音または音声アップロードをすると、話者つき文字起こしとクリック再生を確認できます。</p>
          </div>
        )}
      </section>
    </main>
  )
}

function formatDuration(seconds: number | null) {
  if (!seconds) return '--:--'
  return formatClock(seconds)
}

function formatClock(seconds: number) {
  const rounded = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(rounded / 60)
  const rest = rounded % 60
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

export default App
