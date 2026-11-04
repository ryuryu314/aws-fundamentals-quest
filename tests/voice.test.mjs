import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { recordings, hash, questions, spokenText } from '../scripts/voice-text.mjs'

test('全問題の問題・選択肢・解説が現在の文章に対応する録音である', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/voice/manifest.json', import.meta.url), 'utf8'))
  const items = recordings()
  assert.equal(manifest.credit, 'VOICEVOX:四国めたん')
  assert.equal(manifest.speaker, 2)
  assert.equal(items.length, questions.length * 2)
  assert.equal(Object.keys(manifest.files).length, items.length)
  for (const item of items) {
    const file = manifest.files[item.file]
    assert.ok(file, `${item.file} is missing`)
    assert.equal(file.textHash, hash(item.text), `${item.file} does not match question text`)
    const mp3 = await readFile(new URL(`../public/voice/${item.file}`, import.meta.url))
    assert.equal(mp3.length, file.bytes)
    assert.ok(mp3.length > 1000)
    assert.equal(hash(mp3), file.sha256, `${item.file} is corrupted`)
  }
})
test('AWSサービス名を読み替え、試験用録音と解説を分離する', () => {
  assert.equal(spokenText('Amazon EC2 / AWS IAM').includes('EC2'), false)
  const items = recordings()
  for (const q of questions) {
    const question = items.find(x => x.file === `${q.id}-question.mp3`)
    const explanation = items.find(x => x.file === `${q.id}-explanation.mp3`)
    assert.ok(!question.text.includes('正解は、'))
    assert.ok(explanation.text.includes('正解は、'))
    for (const option of q.options) assert.ok(question.text.includes(spokenText(option)), `${q.id}: omitted option`)
  }
})
