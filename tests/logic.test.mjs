import test from 'node:test'
import assert from 'node:assert/strict'
import { questions as baseQuestions } from '../src/data/questions.ts'
import { extraQuestions } from '../src/data/extraQuestions.ts'
const questions = [...baseQuestions, ...extraQuestions]
import { makeSession, migrateSession, grade, isCorrect, formatTime } from '../src/logic.ts'

test('問題バンクは一意で選択肢と正解の整合性がある', () => {
  assert.equal(new Set(questions.map(q => q.id)).size, questions.length)
  for (const q of questions) {
    assert.ok(q.question && q.explanation)
    assert.ok(q.options.length >= 4)
    assert.ok(q.correctAnswers.length > 0)
    assert.equal(new Set(q.correctAnswers).size, q.correctAnswers.length)
    assert.ok(q.correctAnswers.every(i => Number.isInteger(i) && i >= 0 && i < q.options.length))
    if (q.correctAnswers.length > 1) assert.ok(q.options.length >= 5)
  }
})
test('模試は65問を分野別の比率で重複なく選び90分を設定する', () => {
  const session = makeSession('exam', questions, [], 1000)
  assert.equal(session.ids.length, 65)
  assert.equal(new Set(session.ids).size, 65)
  assert.equal(session.limit, 90 * 60 * 1000)
  assert.equal(session.elapsed, 0)
  const domains = session.ids.map(id => questions.find(q => q.id === id).domain)
  assert.deepEqual(['cloud', 'security', 'technology', 'billing'].map(d => domains.filter(x => x === d).length), [16, 19, 22, 8])
})
test('複数選択は順不同の完全一致のみ正解', () => {
  const q = questions.find(q => q.correctAnswers.length > 1)
  assert.equal(isCorrect(q, [...q.correctAnswers].reverse()), true)
  assert.equal(isCorrect(q, [q.correctAnswers[0]]), false)
  assert.equal(isCorrect(q, []), false)
  const other = q.options.findIndex((_, i) => !q.correctAnswers.includes(i))
  assert.equal(isCorrect(q, [...q.correctAnswers, other]), false)
})
test('採点は未回答を不正解とし、復習は指定問題だけを選ぶ', () => {
  const session = makeSession('weak', questions, [questions[0].id, questions[1].id], 1000)
  session.answers[session.ids[0]] = questions.find(q => q.id === session.ids[0]).correctAnswers
  const result = grade(session, questions, 2000)
  assert.equal(result.correct, 1)
  assert.equal(result.total, 2)
  assert.equal(session.limit, null)
  assert.equal(formatTime(90000), '01:30')
  assert.equal(formatTime(-1), '00:00')
})
test('旧版の締切つきの中断データは、制限時間と経過時間に読み替える', () => {
  const old = { mode: 'exam', ids: ['C01'], answers: {}, flags: [], index: 0, startedAt: 1000, deadline: 1000 + 90 * 60 * 1000 }
  const s = migrateSession(old, 1000 + 10 * 60 * 1000)
  assert.equal(s.limit, 90 * 60 * 1000)
  assert.equal(s.elapsed, 10 * 60 * 1000)
  assert.equal('deadline' in s, false)
  assert.deepEqual(s.graded, {})
  assert.deepEqual(s.revealed, [])
  assert.equal(migrateSession(null), null)
  assert.equal(migrateSession({ mode: 'practice', ids: [] }), null)
})
test('ドパミン演出キットの経験値は簿記ドパミンクエストと同じ計算', async () => {
  globalThis.window = {}
  await import('../src/dopa.js')
  const D = globalThis.window.Dopa
  assert.deepEqual(D.level(60), { lv: 2, xp: 0, need: 95 })
  assert.equal(D.scoreAnswer({ ok: true, combo: 10, random: () => .5 }).gain, 40)
  assert.equal(D.scoreAnswer({ ok: false }).gain, 2)
  assert.equal(D.rankLetter(5, 5), 'S')
})
