import { useEffect, useRef, useState } from 'react'
import { fx, voiceState } from '../fx'

type VoicePlayerProps = { questionId: string; kind: 'question' | 'explanation' }

/** 四国めたん（VOICEVOX）の録音プレーヤー。問題文の前に置き、クレジットを見出しに出す。再生中はBGMを下げる。 */
export function VoicePlayer({ questionId, kind }: VoicePlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [rate, setRate] = useState(1)
  const [error, setError] = useState(false)
  const file = `${questionId}-${kind}.mp3`
  const version = import.meta.env.VITE_VOICE_VERSION
  const label = kind === 'question' ? '問題と選択肢を聞く' : '正解と解説を聞く'

  useEffect(() => {
    const audio = audioRef.current
    const stopOnHide = () => { if (document.hidden) audio?.pause() }
    document.addEventListener('visibilitychange', stopOnHide)
    return () => { if (audio && !audio.paused) { audio.pause(); voiceState.playing = false; fx.bgmHold(false) } document.removeEventListener('visibilitychange', stopOnHide) }
  }, [])

  function startPlayback() {
    const current = audioRef.current
    document.querySelectorAll<HTMLAudioElement>('audio[data-voice-player]').forEach(audio => {
      if (audio !== current) audio.pause()
    })
    voiceState.playing = true; fx.bgmHold(true)
  }
  function stopped() {
    const any = [...document.querySelectorAll<HTMLAudioElement>('audio[data-voice-player]')].some(a => !a.paused && !a.ended)
    if (!any) { voiceState.playing = false; fx.bgmHold(false) }
  }

  function rewind() {
    const audio = audioRef.current
    if (audio) {
      try { audio.currentTime = 0 } catch { /* The file has not loaded yet. */ }
    }
  }

  return <div className="voice-player" aria-label={label}>
    <div className="voice-heading"><span aria-hidden="true">♫</span><strong>{label}</strong><span className="voice-credit">VOICEVOX:四国めたん</span></div>
    <audio ref={audioRef} controls preload="none" data-voice-player aria-label={label}
      src={`${import.meta.env.BASE_URL}voice/${file}?v=${version}`}
      onLoadedMetadata={() => { if (audioRef.current) audioRef.current.playbackRate = rate }}
      onPlay={startPlayback} onPause={stopped} onEnded={stopped} onError={() => { setError(true); stopped() }} onCanPlay={() => setError(false)} />
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
