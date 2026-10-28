import Class                from '../models/Class.model.js'
import Assignment           from '../models/Assignment.model.js'
import AssignmentSubmission from '../models/AssignmentSubmission.model.js'
import Announcement         from '../models/Announcement.model.js'
import { markMCQ, markEssay } from '../utils/marking.utils.js'
import { generateAIJSONWithImages } from '../utils/aiService.js'
import { asyncHandler, AppError } from '../middleware/error.middleware.js'

// ── POST /api/assignments/join ─────────────────────────────────
// A student joins a class by entering the teacher-shared code.
// Note: this only affects assignments created FROM NOW ON — Assignment
// creation eagerly snapshots the class roster into AssignmentSubmission
// docs at that moment (see teacher.controller.js's createAssignment),
// so joining doesn't retroactively backfill submissions for assignments
// that already existed before this student joined.
export const joinClass = asyncHandler(async (req, res) => {
  const { joinCode } = req.body
  if (!joinCode) throw new AppError('Join code is required', 400)

  const cls = await Class.findOne({ joinCode: joinCode.trim().toUpperCase() })
  if (!cls) throw new AppError('Invalid join code', 404)

  if (cls.studentIds.some(id => id.equals(req.user._id))) {
    throw new AppError('You have already joined this class', 409)
  }

  // Global cap on how many distinct students one teacher can be
  // responsible for — counted across ALL of that teacher's classes
  // (not per-class), since a student in two of the same teacher's
  // classes should only count once. Configurable via env var so the
  // number can change without a code change.
  const cap = parseInt(process.env.MAX_STUDENTS_PER_TEACHER, 10) || 30
  const teacherClasses = await Class.find({ teacherId: cls.teacherId }).select('studentIds').lean()
  const distinctStudentIds = new Set(
    teacherClasses.flatMap(c => c.studentIds.map(id => id.toString()))
  )
  // A student already attending one of this teacher's other classes
  // doesn't add to the headcount by joining another — only block when
  // this student would be a genuinely new addition past the cap.
  const isNewStudentForTeacher = !distinctStudentIds.has(req.user._id.toString())
  if (isNewStudentForTeacher && distinctStudentIds.size >= cap) {
    throw new AppError('This teacher has reached their maximum number of students. Please contact your school administrator.', 403)
  }

  cls.studentIds.push(req.user._id)
  await cls.save()

  res.json({ success: true, message: `Joined ${cls.name} (${cls.subject})`, class: cls })
})

// ── GET /api/assignments/classes ───────────────────────────────
// Classes the student has already joined — shown in Settings.
export const getMyClasses = asyncHandler(async (req, res) => {
  const classes = await Class.find({ studentIds: req.user._id })
    .select('name subject examType joinCode teacherId createdAt')
    .populate('teacherId', 'fullName')
    .sort({ createdAt: -1 })
    .lean()

  res.json({ success: true, classes })
})

// ── POST /api/assignments/classes/:classId/leave ─────────────────
// Already-created assignment submissions from this class are untouched
// (see joinClass's note above — access is purely studentId-based), so
// leaving only stops future assignments from this class reaching them.
export const leaveClass = asyncHandler(async (req, res) => {
  const { classId } = req.params

  const cls = await Class.findOne({ _id: classId, studentIds: req.user._id })
  if (!cls) throw new AppError("You're not in this class", 404)

  cls.studentIds = cls.studentIds.filter(id => !id.equals(req.user._id))
  await cls.save()

  res.json({ success: true, message: 'Left class' })
})

// ── GET /api/assignments/announcements ──────────────────────────
// Recent broadcasts from teachers of every class the student is
// currently in. Class-scoped, not student-scoped — leaving a class
// (see leaveClass above) also stops its announcements from showing up,
// same as it stops future assignments.
export const listMyAnnouncements = asyncHandler(async (req, res) => {
  const classes = await Class.find({ studentIds: req.user._id }).select('name subject').lean()
  const classMap = new Map(classes.map(c => [c._id.toString(), c]))

  const announcements = await Announcement.find({ classId: { $in: [...classMap.keys()] } })
    .populate('teacherId', 'fullName')
    .sort({ createdAt: -1 })
    .limit(20)
    .lean()

  res.json({
    success: true,
    announcements: announcements.map(a => ({
      id:          a._id,
      message:     a.message,
      teacherName: a.teacherId?.fullName || 'Your teacher',
      className:   classMap.get(a.classId.toString())?.name || '',
      subject:     classMap.get(a.classId.toString())?.subject || '',
      createdAt:   a.createdAt,
    })),
  })
})

// ── GET /api/assignments ────────────────────────────────────────
// My submissions, joined with assignment/class info for display.
export const listMyAssignments = asyncHandler(async (req, res) => {
  const { subject } = req.query

  const submissions = await AssignmentSubmission.find({ studentId: req.user._id })
    .sort({ createdAt: -1 })
    .populate({
      path: 'assignmentId',
      select: 'title subject examType dueDate releaseDate format questions classId',
      populate: { path: 'classId', select: 'name' },
    })
    .lean()

  const now = Date.now()
  const withDerived = submissions
    .filter(s => s.assignmentId) // guard against an assignment somehow deleted later
    // A scheduled assignment stays fully invisible — not even listed as
    // "not yet released" — until its releaseDate arrives.
    .filter(s => !s.assignmentId.releaseDate || new Date(s.assignmentId.releaseDate).getTime() <= now)
    .map(s => ({
      submissionId: s._id,
      status:       s.status,
      totalMarks:   s.totalMarks,
      availableMarks: s.availableMarks,
      percent:      s.percent,
      title:        s.assignmentId.title,
      subject:      s.assignmentId.subject,
      examType:     s.assignmentId.examType,
      dueDate:      s.assignmentId.dueDate,
      className:    s.assignmentId.classId?.name || '',
      format:       s.assignmentId.format || 'questions',
      questionCount: s.assignmentId.questions?.length || 0,
      createdAt:    s.createdAt,
    }))
    .filter(a => !subject || a.subject === subject)

  res.json({ success: true, assignments: withDerived })
})

// ── GET /api/assignments/pending-count ─────────────────────────
export const getPendingCount = asyncHandler(async (req, res) => {
  // Can't do this as a plain countDocuments — a scheduled assignment's
  // submission already exists (created eagerly like any other), but
  // shouldn't count as "pending" until its releaseDate arrives.
  const submissions = await AssignmentSubmission.find({
    studentId: req.user._id,
    status: { $in: ['assigned', 'in_progress'] },
  }).populate('assignmentId', 'releaseDate').lean()

  const now = Date.now()
  const count = submissions.filter(
    s => !s.assignmentId?.releaseDate || new Date(s.assignmentId.releaseDate).getTime() <= now
  ).length

  res.json({ success: true, count })
})

// ── GET /api/assignments/:submissionId ─────────────────────────
// One assignment + my current answers, for the answer screen.
// Marks the submission 'in_progress' on first open.
export const getSubmission = asyncHandler(async (req, res) => {
  const submission = await AssignmentSubmission.findOne({
    _id: req.params.submissionId,
    studentId: req.user._id,
  }).populate('assignmentId')

  if (!submission) throw new AppError('Assignment not found', 404)

  if (submission.assignmentId.releaseDate && new Date(submission.assignmentId.releaseDate) > new Date()) {
    throw new AppError('This assignment is not available yet', 403)
  }

  if (submission.status === 'assigned') {
    submission.status = 'in_progress'
    await submission.save()
  }

  const assignment = submission.assignmentId
  // 'marked' is the only status where marks/correct-answers are shown —
  // 'pending_review' still locks the answers read-only (can't re-edit
  // after submitting) but must not leak the AI's suggested marks before
  // the teacher signs off, same treatment as an in-progress attempt.
  const isLocked = ['submitted', 'pending_review', 'marked'].includes(submission.status)
  const showResults = submission.status === 'marked'

  res.json({
    success: true,
    submission: {
      id:      submission._id,
      status:  submission.status,
      answers: showResults ? submission.answers : submission.answers.map(a => ({
        studentAnswer: a.studentAnswer, wasScanned: a.wasScanned, scannedFiles: a.scannedFiles,
      })),
      submissionFiles: submission.submissionFiles,
      teacherFeedback: showResults ? submission.teacherFeedback : '',
      totalMarks: showResults ? submission.totalMarks : null,
      // Not hidden pre-marking like totalMarks/percent — this is just
      // "what the assignment is worth", the same kind of thing a
      // question's own `marks` field already reveals below, not a
      // result that needs withholding.
      availableMarks: submission.availableMarks,
      percent: showResults ? submission.percent : null,
      isReview: isLocked,
    },
    // Model answers/correct options are only meaningful once results are
    // shown — hide them otherwise, same principle as sanitiseExam does
    // for mock exams.
    assignment: {
      id: assignment._id,
      title: assignment.title,
      subject: assignment.subject,
      examType: assignment.examType,
      dueDate: assignment.dueDate,
      format: assignment.format,
      attachmentFile: assignment.attachmentFile,
      questions: assignment.questions.map(q => showResults ? q : {
        type: q.type, questionText: q.questionText, options: q.options,
        marks: q.marks, topic: q.topic, hasImage: q.hasImage,
        imageData: q.imageData, parts: q.parts?.map(p => ({ part: p.part, text: p.text, marks: p.marks })),
      }),
    },
  })
})

// ── PATCH /api/assignments/:submissionId/answer ────────────────
// Save one answer without submitting — mirrors mockExam.controller.js's
// saveAnswer, so the browser crashing doesn't lose progress.
export const saveAnswer = asyncHandler(async (req, res) => {
  const { questionIndex, studentAnswer, wasScanned, scannedFiles } = req.body

  const submission = await AssignmentSubmission.findOne({
    _id: req.params.submissionId,
    studentId: req.user._id,
  })
  if (!submission) throw new AppError('Assignment not found', 404)
  if (['submitted', 'pending_review', 'marked'].includes(submission.status)) {
    throw new AppError('This assignment has already been submitted', 400)
  }

  if (!submission.answers[questionIndex]) throw new AppError('Invalid question index', 400)
  submission.answers[questionIndex].studentAnswer = studentAnswer || ''
  // wasScanned is sticky — a submission is flagged for teacher review if
  // scanning was used anywhere in it, even if the student edits the
  // transcribed text afterward. scannedFiles, though, always mirrors
  // whatever is currently attached client-side, empty included, so
  // removing every page doesn't leave stale evidence behind on reload.
  if (wasScanned) submission.answers[questionIndex].wasScanned = true
  if (Array.isArray(scannedFiles)) submission.answers[questionIndex].scannedFiles = scannedFiles
  submission.markModified('answers')
  await submission.save()

  res.json({ success: true })
})

// ── POST /api/assignments/:submissionId/submit ─────────────────
// Marks the paper. Reuses the exact same per-question marking
// primitives practice mode uses (markMCQ/markEssay) — no new marking
// logic, and no batching like mock exams' markFullPaper since an
// assignment is a flat list, not a sectioned paper.
export const submitSubmission = asyncHandler(async (req, res) => {
  const submission = await AssignmentSubmission.findOne({
    _id: req.params.submissionId,
    studentId: req.user._id,
  }).populate('assignmentId')

  if (!submission) throw new AppError('Assignment not found', 404)
  if (['submitted', 'pending_review', 'marked'].includes(submission.status)) {
    throw new AppError('This assignment has already been submitted', 400)
  }
  if (submission.assignmentId.format === 'file') {
    throw new AppError('This is a PDF handout — upload your solved work instead of submitting answers.', 400)
  }

  const assignment = submission.assignmentId
  submission.status = 'submitted'
  submission.submittedAt = new Date()

  let totalMarks = 0
  let availableMarks = 0
  let hasScannedAnswer = false

  for (let i = 0; i < assignment.questions.length; i++) {
    const question = assignment.questions[i]
    const studentAnswer = submission.answers[i]?.studentAnswer || ''
    const wasScanned = !!submission.answers[i]?.wasScanned
    if (wasScanned) hasScannedAnswer = true
    availableMarks += question.marks || 0

    let result
    if (!studentAnswer.trim()) {
      result = { isCorrect: false, marksAwarded: 0, partResults: [], overallFeedback: 'Not answered.' }
    } else if (question.type === 'MCQ') {
      result = markMCQ(studentAnswer, question.correctOption, question.marks)
    } else {
      result = await markEssay(question, studentAnswer, assignment.subject)
    }

    totalMarks += result.marksAwarded || 0
    submission.answers[i] = {
      studentAnswer,
      wasScanned,
      marksAwarded: result.marksAwarded || 0,
      aiMarksAwarded: result.marksAwarded || 0,
      isCorrect:    result.isCorrect || false,
      aiFeedback:   result.overallFeedback || '',
      partResults:  result.partResults || [],
    }
  }

  submission.totalMarks     = totalMarks
  submission.availableMarks = availableMarks
  submission.percent        = availableMarks > 0 ? Math.round((totalMarks / availableMarks) * 100) : 0
  submission.markModified('answers')

  // Typed/MCQ-only submissions get instant marking, unchanged from
  // Phase 1. A submission with any photo-scanned answer instead waits
  // for teacher review — the AI's marks are computed and stored above
  // (so the teacher has a starting point) but not shown to the student
  // yet, since scan-transcription accuracy hasn't been human-checked.
  if (hasScannedAnswer) {
    submission.status = 'pending_review'
    await submission.save()
    return res.json({
      success: true,
      message: 'Submitted — your teacher will review before results are shown.',
      results: null,
    })
  }

  submission.status   = 'marked'
  submission.markedAt = new Date()
  await submission.save()

  res.json({
    success: true,
    message: 'Assignment marked',
    results: {
      totalMarks: submission.totalMarks,
      availableMarks: submission.availableMarks,
      percent: submission.percent,
    },
  })
})

// ── POST /api/assignments/:submissionId/submit-file ─────────────
// For a PDF-handout assignment (assignment.format === 'file') — the
// student's solved work is a whole file (one or more photo pages, or a
// single PDF), not per-question answers, so there's nothing to
// auto-mark against. Every submission goes straight to pending_review
// for the teacher to grade manually via teacher.controller.js's
// publishSubmission.
export const submitFileAssignment = asyncHandler(async (req, res) => {
  const { files } = req.body
  if (!Array.isArray(files) || files.length === 0) {
    throw new AppError('Attach your solved work before submitting', 400)
  }

  const submission = await AssignmentSubmission.findOne({
    _id: req.params.submissionId,
    studentId: req.user._id,
  }).populate('assignmentId')

  if (!submission) throw new AppError('Assignment not found', 404)
  if (submission.assignmentId.format !== 'file') {
    throw new AppError('This assignment is not a PDF handout', 400)
  }
  if (['submitted', 'pending_review', 'marked'].includes(submission.status)) {
    throw new AppError('This assignment has already been submitted', 400)
  }

  submission.submissionFiles = files
  submission.status = 'pending_review'
  submission.submittedAt = new Date()
  await submission.save()

  res.json({ success: true, message: "Submitted — your teacher will review and mark it." })
})

// ── POST /api/assignments/extract-photo ─────────────────────────
// Transcribes a scanned answer into text, using the vision-capable AI
// call (generateAIJSONWithImages) — unlike the existing extract-photo
// endpoint on the admin Physical Exam panel, which accepts imageBase64
// but never actually sends it to the AI. Pure preview: nothing is
// saved here. The student reviews/edits the transcription before it's
// saved as their real answer via saveAnswer.
//
// `files`: [{ data (base64), mimeType }, ...] — either one or more
// photos (multi-page answers), or a single entry with
// mimeType 'application/pdf' when the student uploaded a PDF instead.
export const extractAnswerFromPhoto = asyncHandler(async (req, res) => {
  const { files, questionText } = req.body
  if (!Array.isArray(files) || files.length === 0) {
    throw new AppError('No files received', 400)
  }

  const isPdf = files.length === 1 && files[0].mimeType === 'application/pdf'

  const systemPrompt = `You transcribe a student's handwritten or typed exam answer from
${isPdf ? 'a scanned PDF document' : 'one or more photos'} into plain text, exactly as written.
Do not correct, grade, or comment on the answer — just transcribe it.
Respond with valid JSON only. No markdown. No preamble.`

  const prompt = `The question being answered:
${questionText || '(not provided)'}

Transcribe the student's answer shown${files.length > 1 ? `, across these ${files.length} pages in order,` : ''}. If the answer is
labelled in parts — e.g. (a)(i), (a)(ii), (b) — preserve those exact
labels at the start of each part's text, each on its own line, so the
structure is clear. If there are no part labels, just transcribe the
answer as continuous text.

Return this exact JSON structure:
{ "transcribedAnswer": "..." }`

  const result = await generateAIJSONWithImages(
    prompt, systemPrompt,
    files.map(f => ({ mimeType: f.mimeType || 'image/jpeg', data: f.data }))
  )

  res.json({ success: true, transcribedAnswer: result.transcribedAnswer || '' })
})
