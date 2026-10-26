import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams }  from 'react-router-dom'
import { useAuth }          from '../../context/AuthContext'
import { useNotifications } from '../../context/NotificationContext'
import { practiceAPI }      from '../../api/practice.api'
import { assignmentAPI }    from '../../api/assignment.api'
import AppShell             from '../../components/layout/AppShell'
import QuestionCard         from '../../components/QuestionCard'
import ExplanationPanel     from '../../components/ExplanationPanel'
import SessionSummary       from '../../components/SessionSummary'
import SelfStudyPaper       from '../../components/SelfStudyPaper'
import MasteryBadge         from '../../components/MasteryBadge'
import StarRating           from '../../components/StarRating'
import { calculateGrade } from '../../utils/gradeUtils'
import {
  BookOpen, ChevronRight, Shuffle,
  Target, X, Settings, Lock, RotateCcw, Map, List,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { getSubjectsForExamType } from '../../constants/subjects'

// ── PracticePage has 3 internal states ────────────────────────
// 'setup'   → student configures the session
// 'session' → actively answering questions
// 'done'    → session complete, summary shown
export default function PracticePage() {
  const { user } = useAuth()
  const { addBadgeNotifications } = useNotifications()

  // ── Deep-link from the ⌘K command palette ───────────────────
  // /practice?subject=X&topic=Y&autostart=1 jumps straight into a
  // session instead of landing on the setup screen.
  const [searchParams, setSearchParams] = useSearchParams()
  const urlSubject      = searchParams.get('subject')
  const urlTopic        = searchParams.get('topic')
  const shouldAutostart = searchParams.get('autostart') === '1'

  // ── Screen state ───────────────────────────────────────────
  const [screen, setScreen] = useState('setup')

  // ── Setup state ────────────────────────────────────────────
  // examType is locked to the student's registered exam type — a
  // WASSCE student never sees or can request BECE content and vice versa.
  const examType = user?.examType || 'WASSCE'
  const [subject,   setSubject]   = useState(urlSubject || user?.subjects?.[0] || getSubjectsForExamType(examType)[0])
  const [topic,     setTopic]     = useState(urlTopic || '')
  const [qType,     setQType]     = useState('MCQ')
  const [qCount,    setQCount]    = useState(10)
  const [timed,     setTimed]     = useState(false)
  const [topics,    setTopics]    = useState([])
  const [topicsLoading, setTopicsLoading] = useState(false)

  // ── Classes this student has joined ─────────────────────────
  // Drives whether Essay questions require a photo instead of typing
  // — true when a teacher exists for this subject to review it. When
  // false, Essay questions become self-study (display-only, no marking).
  const [myClasses, setMyClasses] = useState([])
  useEffect(() => {
    assignmentAPI.getClasses().then(data => setMyClasses(data.classes || [])).catch(() => {})
  }, [])
  const requiresPhoto = myClasses.some(c => c.subject === subject)
  // No teacher for this subject — an entire Essay session becomes
  // self-study: every question is shown on one page with no answer
  // box, no AI marking, and no final score (see SelfStudyPaper).
  const isSelfStudy = qType === 'Essay' && !requiresPhoto

  // ── Session Path (guided, mastery-gated progression) ────────
  // 'path' is the default, recommended route; 'free' is today's
  // unrestricted topic picker, kept exactly as-is — a student
  // chasing a specific weak topic must never be blocked.
  const [viewMode,     setViewMode]     = useState('path')
  const [sessionPath,  setSessionPath]  = useState([])
  const [pathLoading,  setPathLoading]  = useState(false)

  // ── Session state ──────────────────────────────────────────
  const [questions,    setQuestions]    = useState([])
  const [currentIdx,   setCurrentIdx]   = useState(0)
  const [results,      setResults]      = useState([])   // one per question answered
  const [currentResult,setCurrentResult]= useState(null)
  const [explanation,  setExplanation]  = useState(null)
  const [isExplaining, setIsExplaining] = useState(false)
  const [sessionStart, setSessionStart] = useState(null)
  const [masteryUpdates, setMasteryUpdates] = useState([])

  // ── Timer ──────────────────────────────────────────────────
  const [timerSeconds, setTimerSeconds] = useState(null)
  const timerRef = useRef(null)

  // ── Load topics when subject or exam type changes ──────────
  // Skips clearing `topic` on the very first run when a topic
  // arrived via the command palette deep link (setup above).
  const skipTopicResetRef = useRef(!!urlTopic)
  useEffect(() => {
    const loadTopics = async () => {
      setTopicsLoading(true)
      if (skipTopicResetRef.current) {
        skipTopicResetRef.current = false
      } else {
        setTopic('')
      }
      try {
        const data = await practiceAPI.getTopics({ subject, examType })
        setTopics(data.topics || [])
      } catch (err) {
        toast.error(err.message)
        setTopics([])
      } finally {
        setTopicsLoading(false)
      }
    }
    loadTopics()
  }, [subject, examType])

  // ── Load the Session Path when in guided mode ───────────────
  useEffect(() => {
    if (viewMode !== 'path') return
    const loadPath = async () => {
      setPathLoading(true)
      try {
        const data = await practiceAPI.getSessionPath({ subject, examType })
        setSessionPath(data.sessions || [])
      } catch (err) {
        toast.error(err.message)
        setSessionPath([])
      } finally {
        setPathLoading(false)
      }
    }
    loadPath()
  }, [subject, examType, viewMode])

  // ── Start a session ────────────────────────────────────────
  const handleStart = async () => {
    try {
      const data = await practiceAPI.getQuestions({
        subject,
        examType,
        topic:  topic || undefined,
        type:   qType,
        limit:  qCount,
      })

      if (!data.questions?.length) {
        return toast.error('No questions found for this selection. Try different filters.')
      }

      setQuestions(data.questions)
      setCurrentIdx(0)
      setResults([])
      setCurrentResult(null)
      setExplanation(null)
      setMasteryUpdates([])
      setSessionStart(Date.now())

      // Start timer if timed mode — not for self-study, which has no
      // per-question pacing (all questions shown together, unmarked)
      if (timed && !isSelfStudy) {
        const firstQ = data.questions[0]
        const timePerQ = firstQ?.parts?.length > 0 ? 15 * 60 : qType === 'Essay' ? 35 * 60 : 90
        setTimerSeconds(timePerQ)
      }

      setScreen('session')
    } catch (err) {
      toast.error(err.message)
    }
  }

  // ── Autostart from the command palette deep link ────────────
  // Runs once on mount only — clears the URL params immediately so
  // a refresh or back-navigation doesn't relaunch the session.
  useEffect(() => {
    if (shouldAutostart) {
      setSearchParams({}, { replace: true })
      handleStart()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Handle answer submission ───────────────────────────────
  const handleSubmit = useCallback(async (answer, photoMeta = {}) => {
    // 'next' signal — move to next question
    if (answer === '__next__') {
      clearInterval(timerRef.current)
      setExplanation(null)
      setCurrentResult(null)

      if (currentIdx + 1 >= questions.length) {
        // Session complete
        await finishSession()
        return
      }

      setCurrentIdx(i => i + 1)

      // Reset timer for next question
      if (timed) {
        const q = questions[currentIdx + 1]
        const timePerQ = q?.parts?.length > 0 ? 15 * 60 : q?.type === 'Essay' ? 35 * 60 : 90
        setTimerSeconds(timePerQ)
      }
      return
    }

    // Real answer — submit to server
    const question = questions[currentIdx]
    try {
      const data = await practiceAPI.submitAnswer({
        questionId:    question._id,
        studentAnswer: answer,
        timeTaken:     timed && timerSeconds !== null
          ? (question.type === 'Essay' ? 35 * 60 : 90) - timerSeconds
          : 0,
        wasScanned:    photoMeta.wasScanned || false,
        scannedFiles:  photoMeta.scannedFiles || [],
      })

      clearInterval(timerRef.current)

      const result = data.result
      setCurrentResult(result)

      // Track results and mastery updates
      setResults(prev => [...prev, { questionId: question._id, ...result }])
      if (result.masteryUpdate) {
        setMasteryUpdates(prev => {
          const idx = prev.findIndex(u => u.topic === result.masteryUpdate.topic)
          if (idx >= 0) {
            const updated = [...prev]
            updated[idx] = result.masteryUpdate
            return updated
          }
          return [...prev, result.masteryUpdate]
        })
      }
    } catch (err) {
      toast.error('Could not submit answer: ' + err.message)
    }
  }, [currentIdx, questions, timed, timerSeconds])

  // ── Timer countdown ────────────────────────────────────────
  // Never runs for self-study — handleStart skips setting timerSeconds
  // for those sessions (see isSelfStudy above).
  useEffect(() => {
    if (timerSeconds === null || !timed || screen !== 'session') return
    if (timerSeconds <= 0) {
      const q = questions[currentIdx]
      handleSubmit(q?.type === 'MCQ' ? '' : 'Time expired')
      return
    }
    timerRef.current = setInterval(() => setTimerSeconds(s => s - 1), 1000)
    return () => clearInterval(timerRef.current)
  }, [timerSeconds, timed, screen])

  // ── Request AI explanation ─────────────────────────────────
  const handleExplain = async () => {
    const question = questions[currentIdx]
    if (!currentResult) return
    setIsExplaining(true)
    setExplanation(null)
    try {
      const data = await practiceAPI.getExplanation({
        questionId:    question._id,
        studentAnswer: currentResult.studentAnswer || '',
        isCorrect:     currentResult.isCorrect,
        explainToken:  currentResult.explainToken,
      })
      setExplanation(data.explanation)
    } catch (err) {
      toast.error('Could not load explanation: ' + err.message)
    } finally {
      setIsExplaining(false)
    }
  }

  // ── Finish session ─────────────────────────────────────────
  const finishSession = async () => {
    const totalMarks     = results.reduce((s, r) => s + (r.marksAwarded   || 0), 0)
    const availableMarks = results.reduce((s, r) => s + (r.marksAvailable || 0), 0)
    const duration       = Math.round((Date.now() - sessionStart) / 1000)
    const accuracy       = availableMarks > 0
      ? Math.round((totalMarks / availableMarks) * 100) : 0

    try {
      const data = await practiceAPI.saveSession({
        subject, topic, examType,
        questions:     results,
        totalMarks,
        availableMarks,
        duration,
        masteryUpdates,
      })
      addBadgeNotifications(data.newBadges)
    } catch {
      // Non-blocking — session still shows summary
    }

    setScreen('done')
  }

  // ── Finish a self-study session ──────────────────────────────
  // Nothing was answered or marked, so there's no score to save —
  // no saveSession call, just move to the (score-free) done screen.
  const finishSelfStudy = () => {
    clearInterval(timerRef.current)
    setScreen('done')
  }

  // ── Restart ────────────────────────────────────────────────
  const handleRestart = () => {
    setScreen('setup')
    setQuestions([])
    setCurrentIdx(0)
    setResults([])
    setCurrentResult(null)
    setExplanation(null)
    setTimerSeconds(null)
    clearInterval(timerRef.current)
  }

  // ── Session totals for summary ─────────────────────────────
  const totalMarks     = results.reduce((s, r) => s + (r.marksAwarded   || 0), 0)
  const availableMarks = results.reduce((s, r) => s + (r.marksAvailable || 0), 0)
  const accuracy       = availableMarks > 0
    ? Math.round((totalMarks / availableMarks) * 100) : 0
  const duration       = sessionStart
    ? Math.round((Date.now() - sessionStart) / 1000) : 0

  // ─────────────────────────────────────────────────────────────
  return (
    <AppShell
      title="Practice Mode"
      subtitle={screen === 'session'
        ? isSelfStudy
          ? `${subject} · ${questions.length} question${questions.length !== 1 ? 's' : ''} to self-study`
          : `${subject} · Question ${currentIdx + 1} of ${questions.length}`
        : screen === 'done'
        ? 'Session complete'
        : 'Adaptive question practice'
      }
    >
      <div className="max-w-4xl mx-auto">

        {/* ══════════════ SETUP SCREEN ═══════════════════════ */}
        {screen === 'setup' && (
          <div className="space-y-6 animate-fade-in">

            {/* Subject + exam type */}
            <div className="card">
              <h2 className="section-title flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-teal-600" />
                Choose your subject
              </h2>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
                {(user?.subjects?.length > 0 ? user.subjects : getSubjectsForExamType(examType)).map(s => (
                  <button
                    key={s}
                    onClick={() => setSubject(s)}
                    className={`py-2.5 px-3 rounded-xl text-sm font-medium border-2 transition-all text-left ${
                      subject === s
                        ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                        : 'bg-surface text-slate-600 border-slate-200 hover:border-teal-300'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="badge-teal">{examType}</span>
                Practising for your registered exam type
              </div>
            </div>

            {/* Topic picker with mastery indicators */}
            <div className="card">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                <h2 className="section-title flex items-center gap-2 mb-0">
                  <Target className="w-4 h-4 text-teal-600" />
                  Choose a topic
                </h2>
                <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
                  <button
                    onClick={() => setViewMode('path')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      viewMode === 'path' ? 'bg-surface text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Map className="w-3.5 h-3.5" /> Guided Path
                  </button>
                  <button
                    onClick={() => setViewMode('free')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      viewMode === 'free' ? 'bg-surface text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <List className="w-3.5 h-3.5" /> Free Practice
                  </button>
                </div>
              </div>

              {viewMode === 'path' ? (
                <>
                  <p className="text-xs text-slate-400 mb-3">
                    Sessions follow the syllabus order — reach Competent on one to unlock the next.
                    You can still jump ahead any time; nothing here is locked for real.
                  </p>
                  {pathLoading ? (
                    <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
                      <span className="spinner text-teal-500" /> Loading session path…
                    </div>
                  ) : sessionPath.length === 0 ? (
                    <p className="text-sm text-slate-400 py-4 text-center">No topics available yet for this subject.</p>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                      {sessionPath.map(s => {
                        const hasContent = s.questionCount > 0
                        return (
                          <button
                            key={s.topic}
                            disabled={!hasContent}
                            onClick={() => hasContent && setTopic(s.topic)}
                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border-2 text-sm text-left transition-all ${
                              !hasContent
                                ? 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed'
                                : topic === s.topic
                                ? 'bg-teal-50 border-teal-400 text-teal-800'
                                : s.unlocked
                                ? 'bg-surface border-slate-200 text-slate-600 hover:border-teal-200'
                                : 'bg-slate-50 border-slate-100 text-slate-400'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                                !hasContent
                                  ? 'bg-slate-100 text-slate-300'
                                  : s.unlocked ? 'bg-teal-100 text-teal-700' : 'bg-slate-200 text-slate-400'
                              }`}>
                                {hasContent && s.unlocked ? s.sessionNumber : <Lock className="w-3 h-3" />}
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-medium truncate">Session {s.sessionNumber}: {s.topic}</span>
                                  {hasContent && s.reviewDue && (
                                    <span className="badge-amber flex items-center gap-1 text-[10px] flex-shrink-0 px-1.5 py-0.5">
                                      <RotateCcw className="w-2.5 h-2.5" /> Review due
                                    </span>
                                  )}
                                </div>
                                {!hasContent ? (
                                  <p className="text-[11px] text-slate-400 mt-0.5">
                                    No practice questions yet
                                  </p>
                                ) : !s.unlocked && (
                                  <p className="text-[11px] text-slate-400 mt-0.5">
                                    Recommended after completing the previous session
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex-shrink-0 ml-2">
                              {hasContent && <StarRating stars={s.stars} />}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </>
              ) : topicsLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
                  <span className="spinner text-teal-500" /> Loading topics…
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">

                  {/* Mixed option */}
                  <button
                    onClick={() => setTopic('')}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border-2 text-sm transition-all ${
                      !topic
                        ? 'bg-teal-50 border-teal-400 text-teal-800'
                        : 'bg-surface border-slate-200 text-slate-600 hover:border-teal-200'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Shuffle className="w-4 h-4 text-teal-500" />
                      <span className="font-medium">Mixed topics</span>
                    </div>
                    <span className="text-xs text-slate-400">All topics</span>
                  </button>

                  {/* Individual topics */}
                  {topics.map(t => (
                    <button
                      key={t.topic}
                      onClick={() => setTopic(t.topic)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border-2 text-sm transition-all ${
                        topic === t.topic
                          ? 'bg-teal-50 border-teal-400 text-teal-800'
                          : 'bg-surface border-slate-200 text-slate-600 hover:border-teal-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium truncate">{t.topic}</span>
                        <span className="text-xs text-slate-400 flex-shrink-0">
                          {t.count} Qs
                        </span>
                      </div>
                      <div className="flex-shrink-0 ml-2">
                        <MasteryBadge score={t.score} size="sm" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Session options */}
            <div className="card">
              <h2 className="section-title flex items-center gap-2">
                <Settings className="w-4 h-4 text-teal-600" />
                Session options
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

                {/* Question type */}
                <div>
                  <label className="label">Question type</label>
                  <div className="flex flex-col gap-1.5">
                    {['MCQ', 'Essay'].map(t => (
                      <button
                        key={t}
                        onClick={() => setQType(t)}
                        className={`py-2 px-3 rounded-lg text-sm font-medium border-2 text-left transition-all ${
                          qType === t
                            ? 'bg-teal-600 text-white border-teal-600'
                            : 'bg-surface text-slate-600 border-slate-200 hover:border-teal-300'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Number of questions */}
                <div>
                  <label className="label">Number of questions</label>
                  <div className="flex flex-col gap-1.5">
                    {[5, 10, 20, 40].map(n => (
                      <button
                        key={n}
                        onClick={() => setQCount(n)}
                        className={`py-2 px-3 rounded-lg text-sm font-medium border-2 text-left transition-all ${
                          qCount === n
                            ? 'bg-teal-600 text-white border-teal-600'
                            : 'bg-surface text-slate-600 border-slate-200 hover:border-teal-300'
                        }`}
                      >
                        {n} questions
                        {n === 40 && <span className="text-xs opacity-70 ml-1">(full section)</span>}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Timed mode */}
                <div>
                  <label className="label">Mode</label>
                  <div className="flex flex-col gap-1.5">
                    {[
                      { value: false, label: 'Relaxed', desc: 'No time pressure' },
                      { value: true,  label: 'Timed',   desc: 'WAEC time limits'  },
                    ].map(({ value, label, desc }) => (
                      <button
                        key={label}
                        onClick={() => setTimed(value)}
                        className={`py-2 px-3 rounded-lg text-sm font-medium border-2 text-left transition-all ${
                          timed === value
                            ? 'bg-teal-600 text-white border-teal-600'
                            : 'bg-surface text-slate-600 border-slate-200 hover:border-teal-300'
                        }`}
                      >
                        {label}
                        <p className="text-xs mt-0.5 opacity-70">{desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Start button */}
            <button
              onClick={handleStart}
              className="btn-primary w-full py-4 text-base"
            >
              Start practice session
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* ══════════ SELF-STUDY SESSION SCREEN ════════════════ */}
        {screen === 'session' && isSelfStudy && questions.length > 0 && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                onClick={handleRestart}
                className="text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
                aria-label="Exit session"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <SelfStudyPaper
              questions={questions}
              subject={subject}
              onFinish={finishSelfStudy}
            />
          </div>
        )}

        {/* ══════════════ SESSION SCREEN ══════════════════════ */}
        {screen === 'session' && !isSelfStudy && questions[currentIdx] && (
          <div className="space-y-4">

            {/* Progress bar */}
            <div className="flex items-center gap-3 mb-2">
              <div className="flex-1 progress-bar">
                <div
                  className="progress-fill bg-teal-500"
                  style={{ width: `${((currentIdx) / questions.length) * 100}%` }}
                />
              </div>
              <span className="text-xs text-slate-500 flex-shrink-0">
                {currentIdx + 1}/{questions.length}
              </span>
              <button
                onClick={handleRestart}
                className="text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
                aria-label="Exit session"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Question card */}
            <QuestionCard
              key={questions[currentIdx]._id}
              question={questions[currentIdx]}
              questionNumber={currentIdx + 1}
              totalQuestions={questions.length}
              onSubmit={handleSubmit}
              result={currentResult}
              onExplain={handleExplain}
              isExplaining={isExplaining}
              timerSeconds={timed ? timerSeconds : undefined}
              requiresPhoto={requiresPhoto}
              extractPhoto={practiceAPI.extractAnswerFromPhoto}
            />

            {/* Explanation panel — shown below question card */}
            {(explanation || isExplaining) && (
              <ExplanationPanel
                explanation={explanation}
                onClose={() => setExplanation(null)}
              />
            )}
          </div>
        )}

        {/* ══════════ SELF-STUDY DONE SCREEN — no score ════════ */}
        {screen === 'done' && isSelfStudy && (
          <div className="max-w-2xl mx-auto space-y-5 animate-fade-in">
            <div className="card text-center py-8 shadow-md">
              <div className="w-16 h-16 rounded-2xl bg-teal-600 flex items-center justify-center mx-auto mb-4">
                <BookOpen className="w-8 h-8 text-white" />
              </div>
              <p
                className="text-xl font-bold text-slate-900 mb-1"
                style={{ fontFamily: 'var(--font-heading)' }}
              >
                Self-study session complete
              </p>
              <p className="text-slate-500 text-sm">
                You went through {questions.length} question{questions.length !== 1 ? 's' : ''} for {subject}.
                No score is recorded — check your answers against your textbook, notes, or a teacher.
              </p>
            </div>
            <button
              onClick={handleRestart}
              className="btn-secondary w-full py-3 flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" /> Practice again
            </button>
          </div>
        )}

        {/* ══════════════ DONE SCREEN ═════════════════════════ */}
        {screen === 'done' && !isSelfStudy && (
          <SessionSummary
            subject={subject}
            topic={topic}
            examType={examType}
            totalMarks={totalMarks}
            availableMarks={availableMarks}
            accuracy={accuracy}
            duration={duration}
            grade={availableMarks > 0 ? calculateGrade(totalMarks, availableMarks, examType) : null}
            masteryUpdates={masteryUpdates}
            onPracticeAgain={handleRestart}
          />
        )}

      </div>
    </AppShell>
  )
}