import MockExam    from '../models/MockExam.model.js'
import Session     from '../models/Session.model.js'
import User        from '../models/User.model.js'
import Class       from '../models/Class.model.js'
import { checkAndAwardBadges, updateStreak, getBadgeDetails } from '../utils/badge.utils.js'
import {
  generatePaper,
  markFullPaper,
  generateExaminerComment,
} from '../utils/mockGenerator.utils.js'
import {
  calculateGrade,
  generateExplanation,
  generateMarkingChecklist,
} from '../utils/marking.utils.js'
import { asyncHandler, AppError } from '../middleware/error.middleware.js'
import { resolveExamType } from '../utils/examType.utils.js'

// ── POST /api/mock-exams/generate ──────────────────────────────
// Generates a full WAEC-standard paper for the student.
// Uses prediction data + mastery profile to weight question selection.
export const generateMockExam = asyncHandler(async (req, res) => {
  const { subject } = req.body
  const examType = resolveExamType(req, req.body.examType)

  if (!subject) throw new AppError('Subject is required', 400)

  // Check if student has an in-progress exam
  const existing = await MockExam.findOne({
    studentId: req.user._id,
    subject,
    status: 'in_progress',
  })

  if (existing) {
    return res.json({
      success:  true,
      message:  'Resuming existing exam',
      exam:     sanitiseExam(existing),
      resumed:  true,
    })
  }

  // Generate the paper
  const paper = await generatePaper(req.user._id, subject, examType)

  const exam = await MockExam.create({
    studentId:          req.user._id,
    subject,
    examType,
    year:               new Date().getFullYear(),
    status:             'generated',
    sectionA:           paper.sectionA,
    sectionB:           paper.sectionB,
    sectionC:           paper.sectionC,
    sectionCAnswerCount: paper.sectionCAnswerCount,
    timeAllowedMinutes: 160,
  })

  res.status(201).json({
    success: true,
    message: 'Exam paper generated',
    exam:    sanitiseExam(exam),
    resumed: false,
  })
})

// ── POST /api/mock-exams/:id/start ────────────────────────────
// Marks the exam as started and records start time.
// The countdown timer begins from this point.
export const startExam = asyncHandler(async (req, res) => {
  const exam = await MockExam.findOne({
    _id:       req.params.id,
    studentId: req.user._id,
  })

  if (!exam) throw new AppError('Exam not found', 404)
  if (exam.status === 'submitted') throw new AppError('This exam has already been submitted', 400)

  exam.status    = 'in_progress'
  exam.startedAt = exam.startedAt || new Date()
  await exam.save()

  res.json({ success: true, message: 'Exam started', startedAt: exam.startedAt })
})

// ── PATCH /api/mock-exams/:id/answer ──────────────────────────
// Save a student's answer for a single question without submitting.
// Called periodically as student progresses through the paper.
// This is important — if the browser crashes, answers are preserved.
export const saveAnswer = asyncHandler(async (req, res) => {
  const { section, questionIndex, studentAnswer, wasScanned, scannedFiles } = req.body

  if (!['sectionA', 'sectionB', 'sectionC'].includes(section)) {
    throw new AppError('Invalid section', 400)
  }

  const exam = await MockExam.findOne({
    _id:       req.params.id,
    studentId: req.user._id,
    status:    'in_progress',
  })

  if (!exam) throw new AppError('Active exam not found', 404)

  // Update the specific question's answer
  if (exam[section][questionIndex] !== undefined) {
    exam[section][questionIndex].studentAnswer = studentAnswer
    // wasScanned is sticky, same as AssignmentSubmission's saveAnswer —
    // once flagged for teacher review, never cleared by a later save that
    // doesn't set it. scannedFiles, though, always mirrors whatever is
    // currently attached client-side, empty included, so removing every
    // page doesn't leave stale evidence behind on reload.
    if (wasScanned) exam[section][questionIndex].wasScanned = true
    if (Array.isArray(scannedFiles)) exam[section][questionIndex].scannedFiles = scannedFiles
    exam.markModified(section)
    await exam.save()
  }

  res.json({ success: true, message: 'Answer saved' })
})

// ── POST /api/mock-exams/:id/submit ───────────────────────────
// Student submits the full paper for marking.
// Triggers AI marking of all Section B and C answers.
// This is the main action after the exam ends.
export const submitExam = asyncHandler(async (req, res) => {
  const { answers, timeSpentSeconds } = req.body

  // Claim the exam atomically before marking — two overlapping submit
  // requests (a double-click, or a retry while the first is still
  // marking) would otherwise both pass a read-then-check and mark the
  // paper twice: double AI cost, a duplicate Session, double-counted
  // totals. Only the request that flips the status gets to mark.
  const claim = await MockExam.updateOne(
    { _id: req.params.id, studentId: req.user._id, status: { $in: ['generated', 'in_progress'] } },
    { $set: { status: 'submitted' } }
  )

  const exam = await MockExam.findOne({
    _id:       req.params.id,
    studentId: req.user._id,
  })

  if (!exam) throw new AppError('Exam not found', 404)
  if (claim.modifiedCount === 0) {
    if (exam.status === 'marked') {
      return res.json({ success: true, message: 'Already marked', results: exam.results, examId: exam._id })
    }
    if (exam.status === 'pending_review') {
      return res.json({ success: true, message: 'Awaiting your teacher\'s review', results: null, examId: exam._id })
    }
    throw new AppError('This exam is already being marked. Please wait.', 409)
  }

  // From here until the marked result is saved, any failure must hand
  // the exam back to 'in_progress' — otherwise it stays stuck in
  // 'submitted' and the claim above would refuse every retry.
  let gradeInfo
  let marking
  try {
    // ── Apply final answers if provided ─────────────────────────
    if (answers) {
      if (answers.sectionA) {
        answers.sectionA.forEach((ans, i) => {
          if (exam.sectionA[i]) exam.sectionA[i].studentAnswer = ans
        })
      }
      if (answers.sectionB) {
        answers.sectionB.forEach((ans, i) => {
          if (exam.sectionB[i]) exam.sectionB[i].studentAnswer = ans
        })
      }
      if (answers.sectionC) {
        answers.sectionC.forEach((ans, i) => {
          if (exam.sectionC[i]) exam.sectionC[i].studentAnswer = ans
        })
      }
    }

    exam.submittedAt      = new Date()
    exam.timeSpentSeconds = timeSpentSeconds || 0
    exam.markModified('sectionA')
    exam.markModified('sectionB')
    exam.markModified('sectionC')
    await exam.save()

    // ── Was any Section B/C answer photo-scanned? ────────────────
    // Marks are always computed below regardless (same as Assignments —
    // the AI's read is a starting point either way), but if this student
    // is in a teacher's class for this subject AND any answer was
    // scanned, results are withheld until the teacher reviews them.
    const hasScannedAnswer = [...exam.sectionB, ...exam.sectionC].some(q => q.wasScanned)
    const inTeacherClass = hasScannedAnswer
      ? await Class.exists({ subject: exam.subject, studentIds: req.user._id })
      : false
    const needsTeacherReview = hasScannedAnswer && !!inTeacherClass

    // ── Mark the paper ──────────────────────────────────────────
    marking = await markFullPaper(exam)

    // ── Generate examiner comment ────────────────────────────
    const examinerComment = await generateExaminerComment(
      exam.subject,
      marking.totalMarks,
      marking.availableMarks,
      marking.sectionAMarks,
      marking.sectionBMarks,
      marking.sectionCMarks,
      marking.sectionATotal,
      marking.sectionBTotal,
      marking.sectionCTotal,
    )

    gradeInfo = calculateGrade(marking.totalMarks, marking.availableMarks, exam.examType)

    // ── Save marked results ─────────────────────────────────────
    exam.sectionA = marking.markedA
    exam.sectionB = marking.markedB
    exam.sectionC = marking.markedC
    exam.status   = needsTeacherReview ? 'pending_review' : 'marked'
    exam.results  = {
      sectionAMarks:   marking.sectionAMarks,
      sectionBMarks:   marking.sectionBMarks,
      sectionCMarks:   marking.sectionCMarks,
      sectionATotal:   marking.sectionATotal,
      sectionBTotal:   marking.sectionBTotal,
      sectionCTotal:   marking.sectionCTotal,
      totalMarks:      marking.totalMarks,
      availableMarks:  marking.availableMarks,
      percent:         marking.percent,
      waecGrade:       gradeInfo.grade,
      gradeLabel:      gradeInfo.label,
      examinerComment: typeof examinerComment === 'string'
        ? examinerComment
        : examinerComment?.comment || '',
    }
    exam.markModified('sectionA')
    exam.markModified('sectionB')
    exam.markModified('sectionC')
    await exam.save()
  } catch (err) {
    await MockExam.updateOne(
      { _id: exam._id, status: 'submitted' },
      { $set: { status: 'in_progress' } }
    ).catch(() => {})
    throw err
  }

  // ── Save as a session for analytics ──────────────────────────
  await Session.create({
    studentId:     req.user._id,
    sessionType:   'mock',
    subject:       exam.subject,
    examType:      exam.examType,
    totalMarks:    marking.totalMarks,
    availableMarks: marking.availableMarks,
    accuracy:      marking.percent,
    duration:      timeSpentSeconds || 0,
    waecGrade:     gradeInfo.grade,
  })

  // Update user totals
  await User.findByIdAndUpdate(req.user._id, {
    $inc: {
      totalQuestionsAnswered: exam.sectionA.length + exam.sectionB.length + 1,
    },
    lastActive: new Date(),
  })
  await updateStreak(req.user._id)
  const newBadges = getBadgeDetails(await checkAndAwardBadges(req.user._id))
  res.json({
    success:  true,
    message:  needsTeacherReview
      ? 'Submitted — your teacher will review before results are shown.'
      : 'Exam marked successfully',
    results:  needsTeacherReview ? null : exam.results,
    examId:   exam._id,
    newBadges,          // ← add this line
  })
})

// ── GET /api/mock-exams/:id ────────────────────────────────────
// Get a specific exam — used to load in-progress or marked exam.
export const getExam = asyncHandler(async (req, res) => {
  const exam = await MockExam.findOne({
    _id:       req.params.id,
    studentId: req.user._id,
  })

  if (!exam) throw new AppError('Exam not found', 404)

  // Correct answers/marks go out only once the exam is marked — every
  // earlier status hides them: 'generated' (not yet started, so the
  // answers could otherwise be read before starting), 'in_progress',
  // 'submitted' (marking still running), and 'pending_review' (marks
  // computed but not yet the teacher's final word).
  const payload = exam.status === 'marked' ? exam : sanitiseExam(exam)

  res.json({ success: true, exam: payload })
})

// ── POST /api/mock-exams/:id/explain ───────────────────────────
// Student taps "Explain" on a marked question. Cached on the exam
// document so revisiting a question later doesn't re-call the AI.
export const explainQuestion = asyncHandler(async (req, res) => {
  const { section, index } = req.body

  if (!['sectionA', 'sectionB', 'sectionC'].includes(section)) {
    throw new AppError('Invalid section', 400)
  }

  const exam = await MockExam.findOne({
    _id:       req.params.id,
    studentId: req.user._id,
  })

  if (!exam) throw new AppError('Exam not found', 404)

  // Explaining an in-progress exam would leak correctOption/modelAnswer
  // through the back door that sanitiseExam() exists to close.
  if (exam.status !== 'marked') {
    throw new AppError('Explanations are only available after the exam is marked', 400)
  }

  const question = exam[section][index]
  if (!question) throw new AppError('Question not found', 404)

  if (question.aiExplanation) {
    return res.json({ success: true, explanation: question.aiExplanation, cached: true })
  }

  const explanation = question.type === 'MCQ'
    ? { kind: 'mcq', ...(await generateExplanation(question, question.studentAnswer, question.isCorrect, exam.subject)) }
    : { kind: 'checklist', ...(await generateMarkingChecklist(question, exam.subject)) }

  // Atomic, targeted write — avoids the optimistic-concurrency
  // VersionError a load-mutate-save() cycle risks when two explain
  // requests touch the same exam close together (e.g. two questions
  // explained back to back). Last-write-wins is fine here since two
  // concurrently-generated explanations for the same question are
  // semantically equivalent.
  await MockExam.updateOne(
    { _id: req.params.id, studentId: req.user._id },
    { $set: { [`${section}.${index}.aiExplanation`]: explanation } }
  )

  res.json({ success: true, explanation, cached: false })
})

// ── GET /api/mock-exams ────────────────────────────────────────
// Get all mock exams for this student.
export const getMyExams = asyncHandler(async (req, res) => {
  const { subject, status } = req.query

  const filter = { studentId: req.user._id }
  if (subject) filter.subject = subject
  if (status)  filter.status  = status

  const exams = await MockExam.find(filter)
    .sort({ createdAt: -1 })
    .limit(20)
    .select('subject examType status results createdAt submittedAt timeAllowedMinutes')
    .lean()

  res.json({ success: true, exams })
})

// ── GET /api/mock-exams/admin/all-results ─────────────────────
// Admin — see all students' mock exam results.
export const getAllResults = asyncHandler(async (req, res) => {
  const { subject, status = 'marked' } = req.query

  const filter = { status }
  if (subject) filter.subject = subject

  const exams = await MockExam.find(filter)
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('studentId', 'fullName email school')
    .select('subject examType status results createdAt studentId isPhysicalEntry')
    .lean()

  res.json({ success: true, exams })
})

// ── Sanitise exam for in-progress / pending-review state ──────
// Removes correct answers before sending to client. We never want to
// leak answers while the exam is active, or leak the AI's provisional
// marks for a pending_review exam before the teacher has signed off.
const sanitiseExam = (exam) => {
  const obj = exam.toObject ? exam.toObject() : { ...exam }
  const hideMarks = obj.status === 'pending_review'

  const stripMarks = (q) => hideMarks
    ? { ...q, marksAwarded: undefined, isCorrect: undefined, aiFeedback: undefined, partResults: undefined }
    : q

  obj.sectionA = obj.sectionA.map(q => stripMarks({
    ...q,
    correctOption: undefined,  // hidden during exam
    modelAnswer:   undefined,
  }))
  obj.sectionB = obj.sectionB.map(q => stripMarks({
    ...q,
    modelAnswer: undefined,
    parts: q.parts?.map(p => ({ ...p, answer: undefined })),
  }))
  obj.sectionC = obj.sectionC.map(q => stripMarks({
    ...q,
    modelAnswer: undefined,
    parts: q.parts?.map(p => ({ ...p, answer: undefined })),
  }))

  return obj
}