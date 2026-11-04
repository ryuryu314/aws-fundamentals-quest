import { useEffect, useRef, useState } from 'react'
import voiceManifest from '../../public/voice/manifest.json'
const voiceFiles = voiceManifest.files as Record<string, { sha256: string }>

type VoicePlayerProps = { questionId: string; kind: 'question' | 'explanation' }

/** Only the question recording is mounted while taking a quiz. */
export function VoicePlayer({ questionId, kind }: VoicePlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [rate, setRate] = useState(1)
  const [error, setError] = useState(false)
  const file = `${questionId}-${kind}.mp3`
  const version = voiceFiles[file]?.sha256.slice(0, 12) || '1'
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
      src={`${import.meta.env.BASE_URL}voice/${file}?v=${version}`}
      onLoadedMetadata={() => { if (audioRef.current) audioRef.current.playbackRate = rate }}
      onPlay={startPlayback} onError={() => setError(true)} onCanPlay={() => setError(false)} />
    <div className="voice-settings"><button type="button" className="ghost voice-rewind" onClick={rewind}>↺ 最初から</button>
      <label>再生速度 <select value={rate} onChange={event => {
        const next = Number(event.target.value)
        setRate(next)
        if (audioRef.current) audioRef.current.playbackRate = next
      }}><option value={0.8}>0.8倍</option><option value={1}>1倍</option><option value={1.2}>1.2倍</option></select></label>
    </div>
    {error && <div className="voice-error" role="status"><p>音声を読み込めませんでした。通信状態を確認してください。</p><button type="button" className="secondary" onClick={() => { setError(false); audioRef.current?.load() }}>音声を再読み込み</button></div>}
  </div>
}
