// ドパミン演出キット（src/dopa.js）をReactから使うための入口。
// dopa.js は入試クエスト・簿記ドパミンクエストと同じ演出（効果音・BGM・粒子・ハンコ・XP・スロット・一時停止画面）。
import './dopa.js'
import './dopa.css'

export type Chip = [string, string]
export type XpInfo = { lv0: number; f0: number; lv1: number; f1: number; gain: number; up: boolean; title: string; titleUp: boolean }
export type Scored = { gain: number; chips: Chip[]; crit: boolean; feverStart?: boolean }
export type AnswerEvent = Partial<Scored> & {
  ok: boolean; combo?: number; revenge?: boolean; broken?: number; assisted?: boolean; xp?: XpInfo; daily?: boolean; goal?: number
  x?: number; y?: number; host?: Element | null; panel?: Element | null; stage?: Element | null
}
type Action = { label: string; primary?: boolean; onClick?: () => void }
export type Fx = {
  play: (name: string, ...args: unknown[]) => void
  bgm: (name: string) => void; bgmStop: () => void; bgmHold: (on: boolean) => void
  setFever: (on: boolean) => void; reset: (clean?: boolean) => void; lite: () => boolean
  bump: (el: Element | null, cls?: string) => void; pop: (text: string, x: number, y: number, cls?: string) => void
  center: (el: Element | null) => { x: number; y: number }
  stars: (x: number, y: number, n?: number, spd?: number, cols?: string[]) => void
  burst: (x: number, y: number, color: string, n?: number, spd?: number) => void
  slotHTML: (digits: number[], o?: { name?: string; payout?: number; passed?: boolean; static?: boolean }) => string
  pauseScreen: (p: { title?: string; text?: string; actions: Action[] }) => void
  modal: (p: { title?: string; text?: string; actions: Action[] }) => void
  closeOverlay: () => void
  openSettings: (x?: { bgmSong?: () => string; extra?: { label: string; note?: string; get: () => boolean; set: (on: boolean) => void }[] }) => void
  idle: { start: (o: { ms?: number; busy?: () => boolean; onIdle: (reason: 'idle' | 'hidden') => void }) => void; stop: () => void; age: (ms: number) => void }
  moment: {
    start: (title?: string) => void
    answer: (ev: AnswerEvent) => void
    result: (o: { letter: string; rankEl: Element | null; counts: { el: Element | null; to: number; fmt: (n: number) => string }[]; xpEl: Element | null; gain: number; newRec?: string; perfect?: boolean }) => void
    examStart: (sub?: string) => void
    examAnswered: (el: Element | null, n: number) => void
    allAnswered: (el: Element | null) => void
    examJudge: (o: { ok: boolean; part?: boolean; got?: number; sub?: string; nav?: Element | null }) => void
    slot: (o: Record<string, unknown>) => void
    fanfare: (title: string, sub?: string, letter?: string) => void
  }
  debug: { bgm: () => string | null; audio: () => string; particles: () => number }
}
type DopaStatic = {
  create: (o: { key: string; root?: () => Element | null; avatar?: string; sampleTitle?: string }) => Fx
  level: (xp: number) => { lv: number; xp: number; need: number }
  scoreAnswer: (o: { ok: boolean; combo?: number; first?: boolean; revenge?: boolean }) => Scored
  xpInfo: (xp0: number, xp1: number, titleOf: (lv: number) => string) => XpInfo
  rankLetter: (correct: number, total: number) => 'S' | 'A' | 'B' | 'C' | 'D'
  day: (d?: Date) => string
}

export const Dopa = (window as unknown as { Dopa: DopaStatic }).Dopa
export const titleOf = (lv: number) => lv >= 30 ? 'クラウドの賢者' : lv >= 20 ? 'アーキテクト見習い' : lv >= 10 ? 'VPCの番人' : lv >= 5 ? 'リージョン探検家' : 'クラウドひよこ'
export const fx: Fx = Dopa.create({ key: 'cloud-quest', root: () => document.querySelector('.shell'), avatar: `${import.meta.env.BASE_URL}metan/met011.png`, sampleTitle: titleOf(12) })
// 読み上げ（四国めたんの音声）を再生中か。再生中はBGMを下げ、2分の無操作判定も待つ。
export const voiceState = { playing: false }
export function stopVoices() { document.querySelectorAll<HTMLAudioElement>('audio[data-voice-player]').forEach(a => a.pause()); voiceState.playing = false; fx.bgmHold(false) }
