// ── Export the AI-marking evaluation sample (thesis Section 3.1) ─────
// Collects students' essay/structured answers together with the mark
// YankelPrep's AI awarded, draws a sample stratified by subject, and
// writes two files:
//
//   data/teacher_marking_sheet.csv — for the teacher. Question, model
//     answer, mark allocation and the student's answer, with a blank
//     teacher_mark column. No AI mark, no student identity and no
//     typed/handwritten flag, so the teacher marks blind.
//   data/ai_marks_key.csv — kept back from the teacher. The AI's mark,
//     answer source and input type for each answer_id.
//
// Only answers whose stored mark is still the AI's own are eligible.
// Teachers can override AI marks when they publish a reviewed mock exam
// or assignment (publishMockExamReview / publishSubmission), and that
// overwrite isn't flagged, so any mock exam or assignment containing a
// scanned answer is excluded entirely. Practice answers are never
// teacher-reviewed, so they are all eligible — including scanned
// (handwritten) ones, which gives the typed vs handwritten comparison.
// MCQ answers are excluded: they're marked by exact key comparison.
//
// Usage (from server/):
//   npm run eval:export-marking
//   npm run eval:export-marking -- --perSubject=40 --seed=2026
//   npm run eval:export-marking -- --subjects="Mathematics,Science" --examType=BECE
//
// Options:
//   --perSubject  max answers per subject (default 40; 0 = all eligible)
//   --seed        random seed, so the same sample can be re-drawn (default 2026)
//   --subjects    comma-separated subject filter
//   --examType    WASSCE or BECE filter

import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import mongoose from 'mongoose'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../../.env') })

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) {
  console.error('\n❌ MONGODB_URI is missing from your .env file\n')
  process.exit(1)
}

const { default: Question }             = await import('../../src/models/Question.model.js')
const { default: Session }              = await import('../../src/models/Session.model.js')
const { default: MockExam }             = await import('../../src/models/MockExam.model.js')
const { default: AssignmentSubmission } = await import('../../src/models/AssignmentSubmission.model.js')
await import('../../src/models/Assignment.model.js') // registers the model for populate()
const { toCsv } = await import('./csv.js')

const args = {}
process.argv.slice(2).forEach(arg => {
  const match = arg.match(/^--([^=]+)=(.*)$/)
  if (match) args[match[1]] = match[2]
})
const perSubject = args.perSubject !== undefined ? Number(args.perSubject) : 40
const seed = Number(args.seed) || 2026
const subjectFilter = args.subjects ? new Set(args.subjects.split(',').map(s => s.trim())) : null
const examTypeFilter = args.examType || null
const DATA_DIR = join(__dirname, 'data')

// Seeded PRNG (mulberry32) so the sample is reproducible from --seed.
const rng = (() => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
})()
const shuffle = (arr) => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const formatParts = (parts = []) => parts
  .map(p => `(${p.part}) [${p.marks} mark${p.marks === 1 ? '' : 's'}] ${p.text || ''}` +
            (p.answer ? `\n    Expected: ${p.answer}` : ''))
  .join('\n')

const hasAnswer = (text) => typeof text === 'string' && text.trim().length > 0
const isMark = (m) => typeof m === 'number' && Number.isFinite(m)

const wanted = (subject, examType) =>
  (!subjectFilter || subjectFilter.has(subject)) && (!examTypeFilter || examType === examTypeFilter)

const run = async () => {
  await mongoose.connect(MONGODB_URI)
  const candidates = []

  // ── Practice answers ─────────────────────────────────────────────
  const sessions = await Session.find({ sessionType: 'practice', 'questions.type': 'Essay' })
    .select('subject examType questions').lean()
  const practiceAnswers = sessions.flatMap(s => s.questions
    .filter(q => q.type === 'Essay' && hasAnswer(q.studentAnswer) && isMark(q.marksAwarded) && q.marksAvailable > 0)
    .map(q => ({ ...q, sessionSubject: s.subject, sessionExamType: s.examType })))
  const questionDocs = await Question.find({ _id: { $in: practiceAnswers.map(q => q.questionId) } })
    .select('questionText modelAnswer parts topic subject examType').lean()
  const questionById = new Map(questionDocs.map(q => [String(q._id), q]))
  for (const a of practiceAnswers) {
    const q = questionById.get(String(a.questionId))
    if (!q) continue // question since deleted — no wording to show the teacher
    candidates.push({
      source: 'practice', subject: q.subject, exam_type: q.examType, topic: q.topic,
      question: q.questionText, sub_parts: formatParts(q.parts), model_answer: q.modelAnswer || '',
      max_marks: a.marksAvailable, student_answer: a.studentAnswer, ai_mark: a.marksAwarded,
      input_type: a.wasScanned ? 'handwritten' : 'typed',
    })
  }

  // ── Mock exam answers (Sections B and C) ─────────────────────────
  const exams = await MockExam.find({ status: 'marked', isPhysicalEntry: { $ne: true } })
    .select('subject examType sectionB sectionC').lean()
  for (const exam of exams) {
    const theory = [...exam.sectionB, ...exam.sectionC]
    if (theory.some(q => q.wasScanned)) continue // may have been teacher-reviewed
    for (const q of theory) {
      if (!hasAnswer(q.studentAnswer) || !isMark(q.marksAwarded) || !(q.marks > 0)) continue
      candidates.push({
        source: 'mock_exam', subject: exam.subject, exam_type: exam.examType, topic: q.topic,
        question: q.questionText, sub_parts: formatParts(q.parts), model_answer: q.modelAnswer || '',
        max_marks: q.marks, student_answer: q.studentAnswer, ai_mark: q.marksAwarded,
        input_type: 'typed',
      })
    }
  }

  // ── Assignment answers ───────────────────────────────────────────
  const submissions = await AssignmentSubmission.find({ status: 'marked' })
    .populate('assignmentId', 'subject examType format questions').lean()
  for (const sub of submissions) {
    const assignment = sub.assignmentId
    if (!assignment || assignment.format === 'file') continue
    if (sub.answers.some(a => a.wasScanned)) continue // went through teacher review
    assignment.questions.forEach((q, i) => {
      const a = sub.answers[i]
      if (q.type !== 'Essay' || !a || !hasAnswer(a.studentAnswer) || !isMark(a.marksAwarded) || !(q.marks > 0)) return
      candidates.push({
        source: 'assignment', subject: assignment.subject, exam_type: assignment.examType, topic: q.topic,
        question: q.questionText, sub_parts: formatParts(q.parts), model_answer: q.modelAnswer || '',
        max_marks: q.marks, student_answer: a.studentAnswer, ai_mark: a.marksAwarded,
        input_type: 'typed',
      })
    })
  }

  // ── Stratified sample by subject ─────────────────────────────────
  const eligible = candidates.filter(c => wanted(c.subject, c.exam_type))
  const bySubject = new Map()
  for (const c of eligible) {
    const k = `${c.exam_type} | ${c.subject}`
    if (!bySubject.has(k)) bySubject.set(k, [])
    bySubject.get(k).push(c)
  }
  let sample = []
  for (const [, items] of [...bySubject.entries()].sort()) {
    const shuffled = shuffle(items)
    sample.push(...(perSubject > 0 ? shuffled.slice(0, perSubject) : shuffled))
  }
  // Shuffle again across subjects so the teacher's sheet isn't grouped
  // by subject or source, then number the answers in that order.
  sample = shuffle(sample).map((c, i) => ({ answer_id: `A${String(i + 1).padStart(4, '0')}`, ...c }))

  mkdirSync(DATA_DIR, { recursive: true })
  const sheetPath = join(DATA_DIR, 'teacher_marking_sheet.csv')
  const keyPath   = join(DATA_DIR, 'ai_marks_key.csv')
  writeFileSync(sheetPath, toCsv(
    sample.map(c => ({ ...c, teacher_mark: '', teacher_comment: '' })),
    ['answer_id', 'subject', 'exam_type', 'question', 'sub_parts', 'model_answer', 'max_marks',
     'student_answer', 'teacher_mark', 'teacher_comment']))
  writeFileSync(keyPath, toCsv(sample,
    ['answer_id', 'source', 'subject', 'exam_type', 'topic', 'max_marks', 'ai_mark', 'input_type']))

  console.log(`Eligible answers: ${eligible.length} (of ${candidates.length} collected)`)
  console.table([...bySubject.entries()].map(([k, items]) => ({
    subject: k, eligible: items.length, sampled: sample.filter(s => `${s.exam_type} | ${s.subject}` === k).length,
    handwritten: sample.filter(s => `${s.exam_type} | ${s.subject}` === k && s.input_type === 'handwritten').length,
  })))
  console.log(`\nTeacher sheet: ${sheetPath}`)
  console.log(`AI key (do NOT give to the teacher): ${keyPath}`)
  console.log('When the teacher has filled in teacher_mark: python scripts/evaluation/analyze_marking.py\n')
  await mongoose.disconnect()
}

run().catch(err => {
  console.error('\n❌ Fatal error:', err)
  process.exit(1)
})
