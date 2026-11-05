import type { Question } from './data/questions'

export type Domain = Question['domain']
export type Answers = Record<string, number[]>
// limit は制限時間（ミリ秒、なしは null）、elapsed は一時停止・中断中を除いた経過時間。
// graded は答え合わせ済み（練習は「答え合わせ」、本試験は「次へ進む」）、revealed は「解答を見る」を使った問題。
export type Session = {
  mode: 'exam' | 'practice' | 'weak'; ids: string[]; answers: Answers; flags: string[]; index: number; startedAt: number
  limit: number | null; elapsed: number; graded: Record<string, boolean>; revealed: string[]
  combo: number; maxCombo: number; earned: number; lv0: number; best0: number; lamps: string[]
}
export type Result = { id: string; mode: Session['mode']; date: number; ids: string[]; answers: Answers; correct: number; total: number; revealed?: string[]; xp?: number; maxCombo?: number; elapsed?: number; expired?: boolean }
export const DOMAIN_LABELS: Record<Domain, string> = { cloud: 'クラウドのコンセプト', security: 'セキュリティとコンプライアンス', technology: 'クラウド技術とサービス', billing: '請求・料金・サポート' }
export const MODE_LABELS = { exam: '本試験モード', practice: '10問チャレンジ', weak: '苦手を復習' }
export const EXAM_LIMIT = 90 * 60 * 1000
export function shuffle<T>(items: T[]): T[] { const result = [...items]; for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]] } return result }
export function isCorrect(question: Question, answer: number[] = []): boolean { return answer.length === question.correctAnswers.length && question.correctAnswers.every(i => answer.includes(i)) }
export function isComplete(question: Question, answer: number[] = []): boolean { return answer.length === question.correctAnswers.length }
export function makeSession(mode: Session['mode'], questions: Question[], weakIds: string[] = [], now = Date.now()): Session {
  let selected: Question[]
  if (mode === 'exam') {
    const targets: [Domain, number][] = [['cloud', 16], ['security', 19], ['technology', 22], ['billing', 8]]
    selected = targets.flatMap(([domain, count]) => shuffle(questions.filter(q => q.domain === domain)).slice(0, count))
    // Fill any shortage without duplicates while the question bank grows.
    const chosen = new Set(selected.map(q => q.id))
    selected = shuffle([...selected, ...shuffle(questions.filter(q => !chosen.has(q.id))).slice(0, Math.max(0, 65 - selected.length))])
  } else if (mode === 'weak') selected = shuffle(questions.filter(q => weakIds.includes(q.id))).slice(0, 10)
  else selected = shuffle(questions).slice(0, 10)
  return { mode, ids: selected.map(q => q.id), answers: {}, flags: [], index: 0, startedAt: now, limit: mode === 'exam' ? EXAM_LIMIT : null, elapsed: 0, graded: {}, revealed: [], combo: 0, maxCombo: 0, earned: 0, lv0: 1, best0: 0, lamps: [] }
}
// 旧版の保存データ（締切の時刻 deadline）を、経過時間と制限時間に読み替える。
export function migrateSession(raw: unknown, now = Date.now()): Session | null {
  const s = raw as Partial<Session> & { deadline?: number | null }
  if (!s || !Array.isArray(s.ids) || !s.ids.length || !s.mode) return null
  const out: Session = { answers: {}, flags: [], index: 0, startedAt: now, limit: null, elapsed: 0, graded: {}, revealed: [], combo: 0, maxCombo: 0, earned: 0, lv0: 1, best0: 0, lamps: [], ...s } as Session
  if (s.limit === undefined) { out.limit = typeof s.deadline === 'number' ? Math.max(0, s.deadline - (s.startedAt ?? now)) : null; out.elapsed = typeof s.deadline === 'number' ? Math.max(0, now - (s.startedAt ?? now)) : 0 }
  delete (out as { deadline?: unknown }).deadline
  return out
}
export function grade(session: Session, questions: Question[], now = Date.now()): Result {
  const byId = new Map(questions.map(q => [q.id, q]))
  const correct = session.ids.filter(id => { const q = byId.get(id); return q && isCorrect(q, session.answers[id]) }).length
  return { id: `${now}-${Math.random().toString(36).slice(2, 8)}`, mode: session.mode, date: now, ids: session.ids, answers: session.answers, correct, total: session.ids.length, revealed: session.revealed ?? [], maxCombo: session.maxCombo ?? 0, elapsed: session.elapsed ?? 0 }
}
export function formatTime(ms: number): string { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}` }
