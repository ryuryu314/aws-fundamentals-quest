import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { type Question } from './data/questions'
import { questions } from './data/questionBank'
import { VoicePlayer } from './components/VoicePlayer'
import { DOMAIN_LABELS, MODE_LABELS, formatTime, grade, isComplete, isCorrect, makeSession, migrateSession, type Answers, type Domain, type Result, type Session } from './logic'
import { Dopa, fx, stopVoices, titleOf, voiceState, type AnswerEvent, type Chip } from './fx'

// 簿記ドパミンクエストと同じ遊び方:
//  10問チャレンジ・苦手を復習 … 選んで「答え合わせ」→ ハンコ・XP・コンボ・フィーバー。結果はランクS〜D。
//  本試験モード … 「次へ進む」でその問題を答え合わせして大きく◎/✕。結果発表はスロット。
//  どのモードでも「解答を見る」で正解と解説を確認できる（その問題は経験値なし・「解答参照あり」）。
//  2分間操作がない・画面を離れると一時停止し、BGMと制限時間を止める。
type Page = 'home' | 'exam' | 'result' | 'history'
type Progress = { xp: number; q: Record<string, { c: number; w: number; l: number }>; days: Record<string, number>; goals: Record<string, boolean>; bestCombo: number }
type Feedback = { ok: boolean; assisted: boolean; chips: Chip[]; combo: number }
type Pending = { kind: 'answer'; ev: AnswerEvent } | { kind: 'judge'; ok: boolean; nav: number } | { kind: 'lamp'; nav: number; n: number; all: boolean } | null
const SESSION_KEY = 'cloud-quest-session-v1'
const HISTORY_KEY = 'cloud-quest-history-v1'
const WEAK_KEY = 'cloud-quest-weak-v1'
const PROGRESS_KEY = 'cloud-quest-progress-v1'
const FEEDBACK_KEY = 'cloud-quest-feedback-v1'
const GOAL = 10
const RANKMSG: Record<string, string> = { S: '完璧。クラウドがあなたに味方しているのだわ', A: 'あと一歩で、合格の景色が見える', B: '基礎は、もう足もとで固まりはじめている', C: '迷った数だけ、地図は詳しくなる', D: '間違いは、次の正解の種' }
function read<T>(key: string, fallback: T): T { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback } catch { return fallback } }
function save(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* The app remains usable if storage is unavailable. */ } }
const questionMap = new Map(questions.map(q => [q.id, q]))
function isAnswered(id: string, answers: Answers): boolean { const q = questionMap.get(id); return !!q && isComplete(q, answers[id]) }
function streakOf(days: Record<string, number>) { let n = 0; const d = new Date(); if (!days[Dopa.day()]) d.setDate(d.getDate() - 1); while (days[Dopa.day(d)]) { n++; d.setDate(d.getDate() - 1) } return n }
const pctOf = (r: Result) => r.total ? Math.round(r.correct / r.total * 100) : 0
function App() {
  const [session, setSession] = useState<Session | null>(() => migrateSession(read(SESSION_KEY, null)))
  const [history, setHistory] = useState<Result[]>(() => read(HISTORY_KEY, []))
  const [weak, setWeak] = useState<string[]>(() => read(WEAK_KEY, []))
  const [progress, setProgress] = useState<Progress>(() => ({ xp: 0, q: {}, days: {}, goals: {}, bestCombo: 0, ...read<Partial<Progress>>(PROGRESS_KEY, {}) }))
  const [feedback, setFeedback] = useState<Record<string, Feedback>>(() => read(FEEDBACK_KEY, {}))
  const [page, setPage] = useState<Page>('home')
  const [result, setResult] = useState<Result | null>(null)
  const [dialog, setDialog] = useState<'submit' | 'restart' | null>(null)
  const [peekId, setPeekId] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [pendingMode, setPendingMode] = useState<Session['mode']>('exam')
  const [reviewFilter, setReviewFilter] = useState<'all' | 'wrong'>('wrong')
  const pending = useRef<Pending>(null)
  const animateResult = useRef<string | null>(null) // 演出つきで見せる結果（次の結果を開くまで保つ）
  const ranFor = useRef<string | null>(null)
  const resultMeta = useRef<{ best0: number; lvUp: { lv: number; title: string; titleUp: boolean } | null }>({ best0: 0, lvUp: null })
  useEffect(() => { if (session) save(SESSION_KEY, session); else localStorage.removeItem(SESSION_KEY) }, [session])
  useEffect(() => { save(HISTORY_KEY, history) }, [history])
  useEffect(() => { save(WEAK_KEY, weak) }, [weak])
  useEffect(() => { save(PROGRESS_KEY, progress) }, [progress])
  useEffect(() => { save(FEEDBACK_KEY, feedback) }, [feedback])
  const onQuiz = page === 'exam' && !!session
  const isExam = session?.mode === 'exam'
  // BGM: ホーム・結果はメニュー曲、練習はポップ（フィーバーで加速）、本試験はパチスロ風。一時停止中は止める。
  useEffect(() => { if (paused) { fx.bgmStop(); return } fx.bgm(onQuiz ? (isExam ? 'exam' : 'practice') : 'menu') }, [onQuiz, isExam, paused])
  useEffect(() => { fx.setFever(onQuiz && !isExam && (session?.combo ?? 0) >= 10) }, [onQuiz, isExam, session?.combo])
  // 2分間の無操作・画面を離れたら一時停止（読み上げ中は待つ）。
  useEffect(() => { if (!onQuiz || paused) return; fx.idle.start({ busy: () => voiceState.playing, onIdle: reason => pause(reason) }); return () => fx.idle.stop() }, [onQuiz, paused])
  // 経過時間は出題中だけ数える（一時停止・中断中は止まる）。
  useEffect(() => { if (!onQuiz || paused) return; let last = performance.now(); const timer = window.setInterval(() => { const t = performance.now(), d = t - last; last = t; setSession(s => s ? { ...s, elapsed: s.elapsed + d } : s) }, 1000); return () => window.clearInterval(timer) }, [onQuiz, paused])
  useEffect(() => { if (onQuiz && session?.limit && session.elapsed >= session.limit) finish(session, true) }, [session?.elapsed])
  // 答え合わせ・正誤表示の演出は、描画が終わってから出す（ハンコの置き場が必要なため）。
  useEffect(() => {
    const p = pending.current; if (!p) return; pending.current = null
    {
      if (p.kind === 'answer') fx.moment.answer({ ...p.ev, host: document.querySelector('#fb'), panel: document.querySelector('.question-panel'), stage: document.querySelector('.exam-main') })
      else if (p.kind === 'judge') fx.moment.examJudge({ ok: p.ok, sub: p.ok ? 'ナイス判断!' : undefined, nav: document.querySelectorAll('.nav-number')[p.nav] ?? null })
      else { fx.moment.examAnswered(document.querySelectorAll('.nav-number')[p.nav] ?? null, p.n); if (p.all) fx.moment.allAnswered(document.querySelector('.submit-button')) }
      fx.bump(document.querySelector('.combo-badge'))
    }
  })
  const current = session ? questionMap.get(session.ids[session.index]) : undefined
  const answeredCount = session ? session.ids.filter(id => isAnswered(id, session.answers)).length : 0
  const availableWeak = weak.filter(id => questionMap.has(id))
  const latestExam = history.find(h => h.mode === 'exam')
  const level = Dopa.level(progress.xp)
  const today = progress.days[Dopa.day()] || 0
  function start(mode: Session['mode']) { fx.play('ok'); if (session) { setPendingMode(mode); setDialog('restart'); return } launch(mode) }
  function launch(mode: Session['mode']) {
    const next = makeSession(mode, questions, availableWeak); if (!next.ids.length) return
    next.lv0 = level.lv; next.best0 = progress.bestCombo
    setSession(next); setResult(null); setDialog(null); setPaused(false); setPage('exam'); window.scrollTo(0, 0)
    fx.reset(true); if (mode === 'exam') fx.moment.examStart('本試験モード、レバーオン!'); else fx.moment.start('QUEST START')
  }
  function resume() { fx.play('ok'); setPaused(false); setPage('exam'); window.scrollTo(0, 0) }
  function goHome() { stopVoices(); fx.closeOverlay(); fx.reset(true); setPaused(false); setPage('home'); window.scrollTo(0, 0) }
  function updateSession(fn: (s: Session) => Session) { setSession(s => s ? fn(s) : s) }
  // 一時停止（ボタン・2分間の無操作・画面を離れたとき）。BGMも止める。
  function pause(reason: 'idle' | 'hidden' | 'button') {
    stopVoices(); fx.idle.stop(); setPaused(true)
    fx.pauseScreen({ title: '一時停止', text: `${reason === 'idle' ? '2分間操作がなかったので、一時停止しました。<br>' : reason === 'hidden' ? '画面を離れたので、一時停止しました。<br>' : ''}回答は保存されています。一時停止中は${isExam ? '制限時間も' : ''}BGMも止まっています。`, actions: [{ label: '続ける', primary: true, onClick: () => setPaused(false) }, { label: 'ホームへ戻る', onClick: goHome }] })
  }
  function finish(active: Session, expired = false) {
    stopVoices(); fx.idle.stop(); fx.closeOverlay()
    const completed = grade(active, questions)
    completed.expired = expired
    let lvUp: { lv: number; title: string; titleUp: boolean } | null = null
    if (active.mode === 'exam') {
      // 本試験は結果発表で正解数×10XPを払い出す。
      const gain = completed.correct * 10, day = Dopa.day(), answered = active.ids.filter(id => isAnswered(id, active.answers)).length
      const info = Dopa.xpInfo(progress.xp, progress.xp + gain, titleOf)
      lvUp = info.up ? { lv: info.lv1, title: info.title, titleUp: info.titleUp } : null
      completed.xp = gain
      setProgress(p => ({ ...p, xp: p.xp + gain, days: { ...p.days, [day]: (p.days[day] || 0) + answered } }))
    } else completed.xp = active.earned
    resultMeta.current = { best0: active.best0, lvUp }
    animateResult.current = completed.id
    setHistory(old => [completed, ...old].slice(0, 30))
    setWeak(old => { const next = new Set(old); active.ids.forEach(id => { const q = questionMap.get(id); if (!q) return; if (isCorrect(q, active.answers[id])) next.delete(id); else next.add(id) }); return [...next] })
    setSession(null); setResult(completed); setReviewFilter('wrong'); setDialog(null); setPaused(false); setPage('result'); window.scrollTo(0, 0)
  }
  function selectOption(index: number) {
    if (!current || !session || session.graded[current.id]) return
    const previous = session.answers[current.id] || []
    let next: number[]
    if (current.correctAnswers.length === 1) next = [index]; else if (previous.includes(index)) next = previous.filter(n => n !== index); else if (previous.length < current.correctAnswers.length) next = [...previous, index]; else next = previous
    const answers = { ...session.answers, [current.id]: next }
    let lamps = session.lamps
    fx.play('select', index)
    // 本試験は回答がそろうたびにランプ、全問そろったら ALL ANSWERED。
    if (session.mode === 'exam' && isComplete(current, next) && !isComplete(current, previous)) {
      const n = session.ids.filter(id => isAnswered(id, answers)).length, all = n === session.ids.length && !lamps.includes('*')
      if (all) lamps = [...lamps, '*']
      pending.current = { kind: 'lamp', nav: session.index, n, all }
    }
    setSession({ ...session, answers, lamps })
  }
  function go(index: number) { stopVoices(); fx.play('move'); updateSession(s => ({ ...s, index: Math.max(0, Math.min(s.ids.length - 1, index)) })); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  // 練習の答え合わせ。正誤を記録し、XP・コンボ・フィーバーの演出を出す。
  function check(e: MouseEvent<HTMLButtonElement>) {
    if (!session || !current || session.graded[current.id] || !isComplete(current, session.answers[current.id])) return
    const r = e.currentTarget.getBoundingClientRect(), ok = isCorrect(current, session.answers[current.id]), assisted = session.revealed.includes(current.id), day = Dopa.day()
    const p: Progress = { ...progress, q: { ...progress.q }, days: { ...progress.days, [day]: (progress.days[day] || 0) + 1 }, goals: { ...progress.goals } }
    const s: Session = { ...session, graded: { ...session.graded, [current.id]: true } }
    let ev: AnswerEvent
    if (assisted) { s.combo = 0; ev = { ok, assisted: true } }
    else {
      const old = progress.q[current.id], rec = old ? { ...old } : { c: 0, w: 0, l: 0 }, revenge = !!old && old.l === 0
      if (ok) { rec.c++; rec.l = 1 } else { rec.w++; rec.l = 0 }
      p.q[current.id] = rec
      if (ok) { s.combo = session.combo + 1; s.maxCombo = Math.max(session.maxCombo, s.combo); p.bestCombo = Math.max(p.bestCombo, s.combo); ev = { ...Dopa.scoreAnswer({ ok: true, combo: s.combo, first: !old, revenge }), ok: true, combo: s.combo, revenge } }
      else { ev = { ...Dopa.scoreAnswer({ ok: false }), ok: false, broken: session.combo }; s.combo = 0 }
      const xp0 = p.xp; p.xp += ev.gain ?? 0; s.earned = session.earned + (ev.gain ?? 0)
      if (!p.goals[day] && p.days[day] >= GOAL) { p.goals[day] = true; p.xp += 30; ev.daily = true; ev.goal = GOAL }
      ev.xp = Dopa.xpInfo(xp0, p.xp, titleOf)
    }
    setFeedback(f => ({ ...f, [current.id]: { ok, assisted, chips: assisted ? [] : (ev.chips ?? []), combo: ev.combo ?? 0 } }))
    setProgress(p); setSession(s)
    pending.current = { kind: 'answer', ev: { ...ev, x: r.left + r.width / 2, y: r.top + r.height / 2 } }
  }
  function nextPractice() { if (!session) return; stopVoices(); if (session.index === session.ids.length - 1) { finish(session); return } fx.play('whoosh'); go(session.index + 1) }
  // 本試験の「次へ進む」: 回答がそろっていれば答え合わせして正誤を大きく出し、次の問題へ。
  function nextExam() {
    if (!session || !current) return
    let s = session
    if (!s.graded[current.id] && isComplete(current, s.answers[current.id])) { s = { ...s, graded: { ...s.graded, [current.id]: true } }; pending.current = { kind: 'judge', ok: isCorrect(current, s.answers[current.id]), nav: s.index } }
    stopVoices()
    if (s.index < s.ids.length - 1) { setSession({ ...s, index: s.index + 1 }); fx.play('whoosh'); window.scrollTo({ top: 0, behavior: 'smooth' }) }
    else { setSession(s); setDialog('submit') }
  }
  function peek() {
    if (!session || !current) return
    if (!session.graded[current.id] && !session.revealed.includes(current.id)) updateSession(s => ({ ...s, revealed: [...s.revealed, current.id] }))
    stopVoices(); fx.play('pick'); setPeekId(current.id)
  }
  function openSettings() { fx.play('ok'); fx.openSettings({ bgmSong: () => onQuiz ? (isExam ? 'exam' : 'practice') : 'menu' }) }
  const domainScores = useMemo(() => { if (!result) return []; return (Object.keys(DOMAIN_LABELS) as Domain[]).map(domain => { const ids = result.ids.filter(id => questionMap.get(id)?.domain === domain); return { domain, total: ids.length, correct: ids.filter(id => isCorrect(questionMap.get(id)!, result.answers[id])).length } }).filter(row => row.total) }, [result])
  // 結果発表: 本試験はスロット、練習はランクを叩きつける。履歴から開いたときは演出なしで最終の表示。
  const animating = !!result && animateResult.current === result.id && !fx.lite()
  useEffect(() => {
    if (page !== 'result' || !result || animateResult.current !== result.id || ranFor.current === result.id) return
    ranFor.current = result.id
    const pct = pctOf(result), passed = pct >= 70
    {
      if (result.mode === 'exam') {
        const box = document.querySelector('#slot-box'); if (!box) return
        fx.moment.slot({ machine: box.querySelector('.dopa-slot'), reels: [...box.querySelectorAll('.dopa-reel')], digits: String(pct).padStart(3, '0').split('').map(Number), gogo: box.querySelector('.dopa-gogo'), scoreEl: document.querySelector('#score-n'), scoreText: String(pct), passed, perfect: pct === 100, chance: !passed && pct >= 60, need: `${70 - pct}%`, tier: pct >= 100 ? 4 : pct >= 90 ? 3 : pct >= 80 ? 2 : 1, seal: document.querySelector('#seal'), verdict: document.querySelector('#verdict'), bar: document.querySelector('#passfill'), pct: pct / 100, sections: [...document.querySelectorAll<HTMLElement>('.domain-fill')].map(el => ({ el, frac: Number(el.dataset.frac) })), payEl: box.querySelector('.dopa-slot-pay b'), payout: result.xp ?? 0, lvUp: resultMeta.current.lvUp, bonusText: passed ? `正答率 ${pct}% · 目標ライン70%を突破` : '' })
      } else {
        const letter = Dopa.rankLetter(result.correct, result.total), assisted = (result.revealed ?? []).length > 0
        fx.moment.result({ letter, rankEl: document.querySelector('#rank'), counts: [{ el: document.querySelector('#score-n'), to: result.correct, fmt: String }, { el: document.querySelector('#st-combo'), to: result.maxCombo ?? 0, fmt: String }, { el: document.querySelector('#st-acc'), to: pct, fmt: n => n + '%' }], xpEl: document.querySelector('#st-xp'), gain: result.xp ?? 0, newRec: !assisted && (result.maxCombo ?? 0) > resultMeta.current.best0 && (result.maxCombo ?? 0) >= 5 ? `最高コンボ ${result.maxCombo}` : '', perfect: letter === 'S' })
      }
    }
  }, [page, result])
  const peekQ = peekId ? questionMap.get(peekId) : undefined
  const graded = !!(session && current && session.graded[current.id])
  const fb = current ? feedback[current.id] : undefined
  return <div className="app">
    <header className="topbar"><button className="brand" onClick={() => { fx.play('back'); goHome() }} aria-label="ホームへ"><span className="brand-mark">☁</span><span>クラウド<span className="brand-accent">クエスト</span><small>AWS STUDY GAME</small></span></button><div className="top-actions"><button className="ghost" onClick={openSettings} aria-label="BGM・効果音・演出の設定">⚙<span className="hide-sm"> 設定</span></button><button className="ghost hide-xs" onClick={() => { fx.play('ok'); setPage('history') }}>学習きろく</button>{session && page !== 'exam' && <button className="secondary compact" onClick={resume}>再開 →</button>}</div></header>
    <main className="shell">
      {page === 'home' && <>
        <section className="hero"><div className="hero-copy"><div className="eyebrow"><span>✦</span> AWS CERTIFIED CLOUD PRACTITIONER</div><h1 className="hero-title">めたんと一緒に、<br/><em>クラウド</em>を攻略！</h1><p className="hero-lead">はじめての AWS も、きっと大丈夫。<br/>答え合わせでハンコとコイン、連続正解でコンボ＆フィーバー！</p><div className="hero-buttons"><button className="primary" onClick={() => start('exam')}>本試験モードに挑戦 <span>→</span></button>{session && <button className="secondary" onClick={resume}>途中から再開</button>}</div><p className="hero-note">✦ 65問　✦ 90分　✦ 2分間操作がないと一時停止（時間も止まる）</p></div><div className="hero-art"><div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/><span className="hero-cloud cloud-one">☁</span><span className="hero-cloud cloud-two">☁</span><div className="speech">一緒にがんばるのだわ！ <span>✦</span></div><img className="metan" src={`${import.meta.env.BASE_URL}metan/met011.png`} alt="四国めたん" /></div></section>
        <section className="panel level-strip"><div className="lv-main"><span className="eyebrow">YOUR LEVEL</span><div className="lv-number"><small>LV.</small>{level.lv}<span>『{titleOf(level.lv)}』</span></div><div className="progress"><div className="progress-fill" style={{ width: `${level.xp / level.need * 100}%` }}/></div><p>{progress.xp} XP　／　次のレベルまで {level.need - level.xp} XP</p></div><div className="lv-goal"><span className="eyebrow">TODAY</span><strong>{Math.min(today, GOAL)} <small>/ {GOAL}問</small></strong><div className="progress goal-bar"><div className="progress-fill" style={{ width: `${Math.min(100, today / GOAL * 100)}%` }}/></div><p>{progress.goals[Dopa.day()] ? '今日の目標達成！ +30 XP' : `あと${Math.max(0, GOAL - today)}問で +30 XP`}</p></div><div className="lv-mini"><div><b>{streakOf(progress.days)}</b><span>連続日数</span></div><div><b>{progress.bestCombo}</b><span>最高コンボ</span></div></div></section>
        <div className="stats"><div className="stat"><span>QUESTION BANK</span><strong>{questions.length}<small> 問</small></strong><p>オリジナル問題</p></div><div className="stat"><span>YOUR CHALLENGES</span><strong>{history.length}<small> 回</small></strong><p>これまでの挑戦</p></div><div className="stat"><span>REVIEW LIST</span><strong>{availableWeak.length}<small> 問</small></strong><p>復習したい問題</p></div><div className="stat"><span>LAST EXAM</span><strong>{latestExam ? pctOf(latestExam) : '—'}<small>{latestExam ? ' %' : ''}</small></strong><p>前回の模試正答率</p></div></div>
        <div className="section-heading"><div><span className="eyebrow">CHOOSE YOUR QUEST</span><h2>今日のクエストを選ぼう</h2><p>迷ったら「解答を見る」でいつでも確認できます（その問題は経験値なし）。</p></div><span className="section-sparkle">✳</span></div>
        <div className="mode-grid"><button className="mode-card featured" onClick={() => start('exam')}><span className="mode-icon">✦</span><span className="tag">おすすめ</span><h3>本試験モード</h3><p>65問・90分。「次へ進む」で答え合わせ、結果発表はスロット！</p><span className="mode-link">挑戦する <b>↗</b></span></button><button className="mode-card" onClick={() => start('practice')}><span className="mode-icon lavender">⚡</span><span className="tag muted">気軽に練習</span><h3>10問チャレンジ</h3><p>1問ずつ答え合わせ。連続正解でコンボ、10連続でフィーバー！</p><span className="mode-link">練習する <b>↗</b></span></button><button className="mode-card" onClick={() => start('weak')} disabled={!availableWeak.length}><span className="mode-icon peach">↻</span><span className="tag muted">{availableWeak.length}問を保存中</span><h3>苦手を復習</h3><p>間違えた問題をもう一度。正解すると REVENGE ボーナス！</p><span className="mode-link">{availableWeak.length ? '復習する' : 'まずは問題に挑戦'} <b>↗</b></span></button></div>
        <div className="home-disclaimer">このアプリは非公式の学習教材です。問題は独自作成であり、実際の試験問題ではありません。<a href="https://aws.amazon.com/jp/certification/certified-cloud-practitioner/" target="_blank" rel="noreferrer">公式試験情報 ↗</a></div>
      </>}
      {page === 'exam' && session && current && <div className="exam-layout"><section className="exam-main"><div className="exam-header"><div><span className="eyebrow">{MODE_LABELS[session.mode]} <span className="dot">●</span> {DOMAIN_LABELS[current.domain]}</span><h1>問題 {session.index + 1} <small>/ {session.ids.length}</small></h1></div><div className="exam-header-right">{!isExam && <span className={`combo-badge ${session.combo >= 10 ? 'hot' : ''}`}><b>{session.combo}</b>COMBO</span>}{session.limit ? <div className={`timer ${session.limit - session.elapsed < 300000 ? 'urgent' : ''}`}><span>残り時間</span><strong>{formatTime(session.limit - session.elapsed)}</strong></div> : <div className="timer"><span>経過</span><strong>{formatTime(session.elapsed)}</strong></div>}</div></div><div className="progress" role="progressbar" aria-label="回答済みの問題" aria-valuenow={answeredCount} aria-valuemin={0} aria-valuemax={session.ids.length}><div className="progress-fill" style={{width:`${answeredCount / session.ids.length * 100}%`}}/></div><div className="progress-caption"><span>{answeredCount} / {session.ids.length} 問に回答</span><span>{isExam ? `答え合わせ済み ${Object.keys(session.graded).length}問` : 'いつでも見直せます'}</span></div>
        <div className="panel question-panel"><div className="question-meta"><span className="tag">QUESTION {String(session.index + 1).padStart(2, '0')}</span>{session.revealed.includes(current.id) && <span className="peek-tag">解答参照あり</span>}{isExam && <button className={`flag-button ${session.flags.includes(current.id) ? 'active' : ''}`} onClick={() => { fx.play('pick'); updateSession(s => ({ ...s, flags: s.flags.includes(current.id) ? s.flags.filter(id => id !== current.id) : [...s.flags, current.id] })) }} aria-pressed={session.flags.includes(current.id)}>⚑ {session.flags.includes(current.id) ? '見直しに追加済み' : 'あとで見直す'}</button>}</div>
          <VoicePlayer key={current.id} questionId={current.id} kind="question"/>
          <h2 className="question-title">{current.question}</h2><p className="select-hint">{current.correctAnswers.length === 1 ? '正しいものを１つ選んでください' : `正しいものを ${current.correctAnswers.length} つ選んでください`}</p>
          <div className="option-list" role="group" aria-label="回答の選択肢">{current.options.map((option, i) => { const selected = session.answers[current.id]?.includes(i) ?? false, right = current.correctAnswers.includes(i); return <button key={i} className={`option ${selected ? 'selected' : ''} ${graded ? (right ? 'right' : selected ? 'wrong' : 'dim') : ''}`} onClick={() => selectOption(i)} aria-pressed={selected} disabled={graded}><span className="option-letter">{String.fromCharCode(65 + i)}</span><span>{option}</span><span className="option-check">{graded && right ? '正解' : selected ? '✓' : ''}</span></button> })}</div>
          {!isExam && graded && fb && <div className={`dopa-feedback ${fb.ok ? '' : 'wrong'}`} id="fb"><h3>{fb.ok ? '✓ 正解！' : 'おしい！ ここが伸びしろ'}</h3>{fb.ok && !fb.assisted && fb.combo >= 3 && <p className="dopa-praise">{fb.combo >= 10 ? '神正解!!!' : fb.combo >= 5 ? '連続正解!!' : 'いい流れ!'} {fb.combo} COMBO</p>}{!fb.assisted && fb.chips.length > 0 && <div className="dopa-chips">{fb.chips.map(([t, cls], i) => <span key={i} className={cls} style={{ animationDelay: `${(.3 + i * .08).toFixed(2)}s` }}>{t}</span>)}</div>}{fb.assisted && <p className="muted-note">解答を見た問題なので、経験値・コンボには数えません。</p>}<p className="right-answer"><b>正解：</b>{current.correctAnswers.map(i => current.options[i]).join('、')}</p><VoicePlayer questionId={current.id} kind="explanation"/><div className="explanation"><b>✦ 解説</b><p>{current.explanation}</p></div></div>}
        </div>
        <div className="question-actions">{isExam ? <><button className="secondary" onClick={() => go(session.index - 1)} disabled={session.index === 0}>← 前の問題</button><button className="ghost peek-button" onClick={peek}>{graded ? '解説を見る' : '解答を見る'}</button>{session.index < session.ids.length - 1 ? <button className="primary" onClick={nextExam}>次へ進む →</button> : <button className="primary" onClick={nextExam}>回答を提出する →</button>}</> : graded ? <button className="primary wide-action" onClick={nextPractice}>{session.index === session.ids.length - 1 ? '結果を見る →' : '次へ →'}</button> : <><button className="primary wide-action" onClick={check} disabled={!isComplete(current, session.answers[current.id])}>答え合わせ</button><button className="ghost peek-button" onClick={peek}>解答を見る</button></>}</div></section>
        <aside className="exam-side"><div className="panel nav-panel"><div className="side-heading"><div><span className="eyebrow">QUESTION MAP</span><h2>問題一覧</h2></div><span>☁</span></div>{isExam && <div className="lamp-count">入力 <b>{answeredCount}</b>/{session.ids.length}</div>}<div className="nav-grid">{session.ids.map((id, i) => { const q = questionMap.get(id)!, judged = session.graded[id], ok = judged && isCorrect(q, session.answers[id]); return <button key={id} className={`nav-number ${isAnswered(id, session.answers) ? 'answered' : session.answers[id]?.length ? 'partial' : ''} ${session.flags.includes(id) ? 'flagged' : ''} ${session.index === i ? 'current' : ''} ${judged ? (ok ? 'judged-ok' : 'judged-ng') : ''}`} onClick={() => go(i)} aria-label={`問題 ${i + 1}${judged ? (ok ? '、正解' : '、不正解') : isAnswered(id, session.answers) ? '、回答済み' : session.answers[id]?.length ? '、選択数不足' : '、未回答'}${session.flags.includes(id) ? '、見直し' : ''}`} aria-current={session.index === i ? 'step' : undefined}>{judged ? (ok ? '◎' : '✕') : i + 1}</button> })}</div><div className="nav-legend"><span><i className="legend-answered"/>回答済み</span><span><i className="legend-partial"/>選択数不足</span><span><i className="legend-flag"/>見直し</span></div>{isExam && <button className="secondary full submit-button" onClick={() => { fx.play('ok'); setDialog('submit') }}>回答を提出する</button>}<button className="ghost full" onClick={() => { fx.play('back'); pause('button') }}>中断する</button><p className="side-note">2分間操作がない・画面を離れると一時停止します。{isExam ? '一時停止中は制限時間も止まります。' : ''}</p></div></aside></div>}
      {page === 'result' && result && <><section className="result-hero">{result.mode === 'exam' ? <ExamSlot result={result} animating={animating}/> : <PracticeRank result={result} animating={animating} level={level}/>}<div className="result-actions"><button className="primary" onClick={() => start(result.mode === 'weak' ? (availableWeak.length ? 'weak' : 'practice') : result.mode)}>もう一度挑戦 →</button><button className="secondary" onClick={goHome}>ホームへ</button></div><p className="score-note">表示は正答率です。AWS公式の換算スコアや合否判定ではありません。{(result.revealed ?? []).length > 0 && ` · 解答参照あり ${(result.revealed ?? []).length}問`}{result.expired && ' · 制限時間で自動提出'}</p></section><section className="result-section"><div className="section-heading"><div><span className="eyebrow">YOUR PERFORMANCE</span><h2>分野別の結果</h2></div></div><div className="panel domain-list">{domainScores.map(row => <div className="domain-row" key={row.domain}><div className="domain-label"><strong>{DOMAIN_LABELS[row.domain]}</strong><span>{row.correct} / {row.total} 問</span></div><div className="progress"><div className="progress-fill domain-fill" data-frac={row.correct / row.total} style={{ width: '100%', transformOrigin: 'left center', transform: `scaleX(${animating && result.mode === 'exam' ? 0 : row.correct / row.total})`, transition: 'transform .6s' }}/></div></div>)}</div><div className="section-heading review-heading"><div><span className="eyebrow">LOOK BACK</span><h2>問題を振り返ろう</h2><p>解説を読んで、次の挑戦につなげよう。</p></div><div className="filter-buttons"><button className={reviewFilter === 'wrong' ? 'secondary active-filter' : 'ghost'} onClick={() => setReviewFilter('wrong')}>間違えた問題</button><button className={reviewFilter === 'all' ? 'secondary active-filter' : 'ghost'} onClick={() => setReviewFilter('all')}>すべて</button></div></div><div className="review-list">{result.ids.map((id, i) => { const q = questionMap.get(id); if (!q) return null; const correct = isCorrect(q, result.answers[id]); if (reviewFilter === 'wrong' && correct) return null; return <ReviewCard key={id} q={q} index={i} answer={result.answers[id]} correct={correct} peeked={(result.revealed ?? []).includes(id)}/> })}{reviewFilter === 'wrong' && result.correct === result.total && <div className="panel empty">全問正解！すばらしいのだわ ✦</div>}</div></section></>}
      {page === 'history' && <section className="history-section"><div className="section-heading"><div><span className="eyebrow">YOUR JOURNEY</span><h1>学習きろく</h1><p>これまでの挑戦を振り返ろう。</p></div><button className="secondary" onClick={goHome}>← ホームへ</button></div>{history.length ? <div className="review-list">{history.map(item => <button className="panel history-row" key={item.id} onClick={() => { fx.play('ok'); animateResult.current = null; setResult(item); setReviewFilter('wrong'); setPage('result'); window.scrollTo(0, 0) }}><div><span className="tag">{MODE_LABELS[item.mode]}</span><h3>{new Date(item.date).toLocaleString('ja-JP')}</h3><p>{item.total}問中 {item.correct}問正解{(item.revealed ?? []).length ? '・解答参照あり' : ''}</p></div><strong>{pctOf(item)}<small>%</small> →</strong></button>)}</div> : <div className="panel empty">まだ記録がありません。<br/>最初のクエストに挑戦してみよう！</div>}</section>}
    </main><footer className="footer"><span>☁ CLOUD QUEST <b>✦</b> 一歩ずつ、クラウドの世界へ。</span><span>音声：VOICEVOX:四国めたん　／　BGM・効果音：アプリ内で合成　／　立ち絵：<a href="https://zunko.jp/con_illust.html#illust_00500" target="_blank" rel="noreferrer">東北ずん子・ずんだもんプロジェクト</a></span></footer>
    {dialog && <div className="modal-backdrop" onClick={() => setDialog(null)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onClick={e => e.stopPropagation()}><span className="modal-icon">✦</span><h2 id="dialog-title">{dialog === 'submit' ? '回答を提出しますか？' : '新しく始めますか？'}</h2><p>{dialog === 'submit' ? `${session?.ids.length}問中 ${answeredCount}問に回答済みです。未回答や選択数が不足した問題は不正解になります。結果発表はスロットで！` : '現在の途中データは消去され、新しいクエストが始まります。'}</p><div className="modal-actions"><button className="secondary" onClick={() => { fx.play('back'); setDialog(null) }}>戻る</button><button className="primary" onClick={() => dialog === 'submit' && session ? finish(session) : launch(pendingMode)}>{dialog === 'submit' ? '提出する' : '新しく始める'}</button></div></div></div>}
    {peekQ && <div className="modal-backdrop" onClick={() => setPeekId(null)}><div className="modal peek-modal" role="dialog" aria-modal="true" aria-labelledby="peek-title" onClick={e => e.stopPropagation()}><span className="modal-icon">✦</span><h2 id="peek-title">解答です</h2><p className="right-answer"><b>正解：</b>{peekQ.correctAnswers.map(i => peekQ.options[i]).join('、')}</p><VoicePlayer questionId={peekQ.id} kind="explanation"/><div className="explanation"><b>✦ 解説</b><p>{peekQ.explanation}</p></div>{session && !session.graded[peekQ.id] && <p className="muted-note">この問題は経験値・コンボに数えません（結果に「解答参照あり」と残ります）。</p>}<div className="modal-actions"><button className="primary" onClick={() => { fx.play('back'); stopVoices(); setPeekId(null) }}>問題に戻る</button></div></div></div>}
  </div>
}
function ExamSlot({ result, animating }: { result: Result; animating: boolean }) {
  const pct = pctOf(result), passed = pct >= 70
  return <><span className="eyebrow">EXAM RESULT ✦</span><div id="slot-box" dangerouslySetInnerHTML={{ __html: fx.slotHTML(String(pct).padStart(3, '0').split('').map(Number), { name: 'CLOUD SLOT', payout: result.xp ?? 0, passed, static: !animating }) }}/><div className="score-box"><span className={`dopa-seal ${!animating && passed ? 'go' : ''}`} id="seal">目標達成</span><div className="score"><span id="score-n">{animating ? '??' : pct}</span><small>%</small></div></div><div className="dopa-passbar" style={{ ['--line' as string]: '70%' }}><i id="passfill" style={{ transform: `scaleX(${animating ? 0 : pct / 100})` }}/><b data-label="目標 70%"/></div><h1 className={`dopa-verdict ${animating ? '' : 'show'}`} id="verdict">{passed ? '目標ライン70%を突破！' : '次の一歩が、見えてきた。'}</h1><p><strong>{result.total}問中 {result.correct}問正解</strong>　/　{MODE_LABELS[result.mode]}{result.xp ? `　/　+${result.xp} XP` : ''}</p></>
}
function PracticeRank({ result, animating, level }: { result: Result; animating: boolean; level: { lv: number; xp: number; need: number } }) {
  const pct = pctOf(result), letter = Dopa.rankLetter(result.correct, result.total)
  return <><span className="eyebrow">QUEST COMPLETE ✦</span><div className={`dopa-rank r-${letter} ${animating ? '' : 'go'}`} id="rank" role="img" aria-label={`ランク ${letter}`}>{letter}</div><p className="dopa-rankmsg">{RANKMSG[letter]}</p><div className="score"><span id="score-n">{animating ? 0 : result.correct}</span><small> / {result.total} 問正解</small></div><div className="result-stats"><div><strong id="st-combo">{animating ? 0 : result.maxCombo ?? 0}</strong><span>最高コンボ</span></div><div><strong id="st-xp">+{animating ? 0 : result.xp ?? 0}</strong><span>獲得XP</span></div><div><strong id="st-acc">{animating ? 0 : pct}%</strong><span>正答率</span></div></div><div className="lv-row">Lv.{level.lv}『{titleOf(level.lv)}』<div className="progress"><div className="progress-fill" style={{ width: `${level.xp / level.need * 100}%` }}/></div></div></>
}
function ReviewCard({ q, index, answer, correct, peeked }: { q: Question; index: number; answer?: Answers[string]; correct: boolean; peeked?: boolean }) { return <article className={`panel review-card ${correct ? 'correct' : 'incorrect'}`}><div className="review-meta"><span className="tag">問題 {index + 1}　/　{DOMAIN_LABELS[q.domain]}</span>{peeked && <span className="peek-tag">解答参照あり</span>}<strong>{correct ? '✓ 正解' : '△ 伸びしろ'}</strong></div><h3>{q.question}</h3><p><b>あなたの回答：</b>{answer?.length ? answer.map(i => q.options[i]).join('、') : '未回答'}</p><p className="right-answer"><b>正解：</b>{q.correctAnswers.map(i => q.options[i]).join('、')}</p><VoicePlayer questionId={q.id} kind="explanation"/><div className="explanation"><b>✦ 解説</b><p>{q.explanation}</p></div></article> }
export default App
