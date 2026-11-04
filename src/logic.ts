import type { Question } from './data/questions'

export type Domain = Question['domain']
export type Answers = Record<string, number[]>
export type Session = { mode: 'exam' | 'practice' | 'weak'; ids: string[]; answers: Answers; flags: string[]; index: number; startedAt: number; deadline: number | null }
export type Result = { id: string; mode: Session['mode']; date: number; ids: string[]; answers: Answers; correct: number; total: number }
export const DOMAIN_LABELS: Record<Domain, string> = { cloud: 'クラウドのコンセプト', security: 'セキュリティとコンプライアンス', technology: 'クラウド技術とサービス', billing: '請求・料金・サポート' }
export const MODE_LABELS = { exam: '本試験モード', practice: '10問チャレンジ', weak: '苦手を復習' }
export function shuffle<T>(items: T[]): T[] { const result = [...items]; for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]] } return result }
export function isCorrect(question: Question, answer: number[] = []): boolean { return answer.length === question.correctAnswers.length && question.correctAnswers.every(i => answer.includes(i)) }
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
  return { mode, ids: selected.map(q => q.id), answers: {}, flags: [], index: 0, startedAt: now, deadline: mode === 'exam' ? now + 90 * 60 * 1000 : null }
}
export function grade(session: Session, questions: Question[], now = Date.now()): Result {
  const byId = new Map(questions.map(q => [q.id, q]))
  const correct = session.ids.filter(id => { const q = byId.get(id); return q && isCorrect(q, session.answers[id]) }).length
  return { id: `${now}-${Math.random().toString(36).slice(2, 8)}`, mode: session.mode, date: now, ids: session.ids, answers: session.answers, correct, total: session.ids.length }
}
export function formatTime(ms: number): string { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}` }
