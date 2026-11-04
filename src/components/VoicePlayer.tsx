import { useEffect, useRef, useState } from 'react'

type VoicePlayerProps = { questionId: string; kind: 'question' | 'explanation' }

/** Only the question recording is mounted while taking a quiz. */
export function VoicePlayer({ questionId, kind }: VoicePlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [rate, setRate] = useState(1)
  const [error, setError] = useState(false)
  const label = kind === 'question' ? '問題と選択肢を聞く' : '正解と解説を聞く'

  useEffect(() => {
    const audio = audioRef.current
    const stopOnHide = () => { if (document.hidden) audio?.pause() }
    document.addEventListener('visibilitychange', stopOnHide)
    return () => { audio?.pause(); document.removeEventListener('visibilitychange', stopOnHide) }
  }, [])

  function startPlayback() {
    const current = audioRef.current
    document.querySelectorAll<HTMLAudioElement>('audio[data-voice-player]').forEach(audio => {
      if (audio !== current) audio.pause()
    })
  }

  function rewind() {
    const audio = audioRef.current
    if (audio) {
      try { audio.currentTime = 0 } catch { /* The file has not loaded yet. */ }
    }
  }

  return <div className="voice-player" aria-label={label}>
    <div className="voice-heading"><span aria-hidden="true">♫</span><strong>{label}</strong><span>VOICEVOX:四国めたん</span></div>
    <audio ref={audioRef} controls preload="none" data-voice-player aria-label={label}
      src={`${import.meta.env.BASE_URL}voice/${questionId}-${kind}.mp3`}
      onPlay={startPlayback} onError={() => setError(true)} onCanPlay={() => setError(false)} />
    <div className="voice-settings"><button type="button" className="ghost voice-rewind" onClick={rewind}>↺ 最初から</button>
      <label>再生速度 <select value={rate} onChange={event => {
        const next = Number(event.target.value)
        setRate(next)
        if (audioRef.current) audioRef.current.playbackRate = next
      }}><option value={0.8}>0.8倍</option><option value={1}>1倍</option><option value={1.2}>1.2倍</option></select></label>
    </div>
    {error && <p className="voice-error" role="status">音声を読み込めませんでした。時間をおいて再度お試しください。</p>}
  </div>
}
