import Question      from '../models/Question.model.js'
import MasteryProfile from '../models/MasteryProfile.model.js'
import Session       from '../models/Session.model.js'
import User          from '../models/User.model.js'
  import { checkAndAwardBadges, updateStreak, getBadgeDetails } from '../utils/badge.utils.js'
import {
  markMCQ,
  markEssay,
  generateExplanation,
  computeMasteryUpdate,
  calculateGrade,
  scoreToStars,
  UNLOCK_THRESHOLD,
} from '../utils/marking.utils.js'
import { asyncHandler, AppError } from '../middleware/error.middleware.js'
import { resolveExamType } from '../utils/examType.utils.js'
import { getCanonicalTopics } from '../data/beceCurriculum.js'
import { ANSWER_FIELDS } from './question.controller.js'
import { generateExplainToken, isValidExplainToken } from '../utils/jwt.js'

// ── GET /api/practice/questions ────────────────────────────────
// Fetches questions for a practice session.
// Uses the student's mastery profile to determine
// which difficulty level to serve.
export const getPracticeQuestions = asyncHandler(async (req, res) => {
  const {
    subject,
    topic,
    type,                    // MCQ, Essay — optional filter
    limit = 10,
  } = req.query
  const examType = resolveExamType(req, req.query.examType)

  if (!subject) throw new AppError('Subject is required', 400)

  // ── Get student's current mastery for this topic ───────────
  let targetDifficulty = 2  // default: Standard
  if (topic) {
    const mastery = await MasteryProfile.findOne({
      studentId: req.user._id,
      subject,
      topic,
    })
    if (mastery) targetDifficulty = mastery.difficulty
  }

  // ── Build question filter ──────────────────────────────────
  const filter = {
    subject,
    examType,
    isActive: true,
    // Serve questions at or near the student's level
    difficulty: {
      $in: [
        Math.max(1, targetDifficulty - 1),
        targetDifficulty,
        Math.min(5, targetDifficulty + 1),
      ],
    },
  }

  if (topic) filter.topic = topic
  if (type)  filter.type  = type

  // ── Fetch and shuffle ──────────────────────────────────────
  const total = await Question.countDocuments(filter)
  const skip  = Math.floor(Math.random() * Math.max(0, total - Number(limit)))

  const questions = await Question.find(filter)
    .skip(skip)
    .limit(Number(limit))
    // No answers (they come back from submitAnswer once marked) and no
    // diagram data (fetched lazily per-question when needed).
    .select(`${ANSWER_FIELDS} -imageData`)
    .lean()

  // ── Get mastery data for all topics returned ───────────────
  const topics = [...new Set(questions.map(q => q.topic))]
  const masteryProfiles = await MasteryProfile.find({
    studentId: req.user._id,
    subject,
    topic: { $in: topics },
  }).lean()

  const masteryMap = masteryProfiles.reduce((map, m) => {
    map[m.topic] = m
    return map
  }, {})

  res.json({
    success:   true,
    count:     questions.length,
    questions: questions.map(q => ({
      ...q,
      // Attach mastery info to each question's topic
      topicMastery: masteryMap[q.topic] || null,
    })),
  })
})

// ── GET /api/practice/topics ───────────────────────────────────
// Returns all topics for a subject with the student's mastery
// score for each — used by the topic picker on the practice page.
export const getTopicsWithMastery = asyncHandler(async (req, res) => {
  const { subject } = req.query
  const examType = resolveExamType(req, req.query.examType)
  if (!subject) throw new AppError('Subject is required', 400)

  // All distinct topics in question bank for this subject
  const topicAgg = await Question.aggregate([
    { $match: { subject, examType, isActive: true } },
    {
      $group: {
        _id:         '$topic',
        count:       { $sum: 1 },
        latestYear:  { $max: '$year' },
      },
    },
    { $sort: { count: -1 } },
  ])

  // Student's mastery for these topics
  const masteryProfiles = await MasteryProfile.find({
    studentId: req.user._id,
    subject,
  }).lean()

  const masteryMap = masteryProfiles.reduce((map, m) => {
    map[m.topic] = m
    return map
  }, {})

  // Merge topic list with mastery data
  const now = new Date()
  const topics = topicAgg.map(t => {
    const m = masteryMap[t._id]
    return {
      topic:      t._id,
      count:      t.count,
      latestYear: t.latestYear,
      mastery:    m || null,
      score:      m?.score      || 0,
      difficulty: m?.difficulty || 2,
      attempted:  !!m,
      reviewDue:  !!(m?.nextReviewDate && m.nextReviewDate <= now),
    }
  })

  res.json({ success: true, subject, topics })
})

// ── GET /api/practice/session-path ──────────────────────────────
// Returns topics for a subject in a recommended mastery-progression
// order, each annotated with the student's star rating and whether
// it's unlocked. This is a *soft* gate — presentation only. The
// practice-questions endpoint above imposes no restriction based on
// it, so a student chasing a prediction-flagged weak topic is never
// actually blocked from reaching it directly via the free picker.
export const getSessionPath = asyncHandler(async (req, res) => {
  const { subject } = req.query
  const examType = resolveExamType(req, req.query.examType)
  if (!subject) throw new AppError('Subject is required', 400)

  // BECE has a real curriculum-ordered topic list (NaCCA strand
  // sequence). WASSCE has no equivalent taxonomy yet — fall back to
  // the same frequency ordering the free topic picker already uses.
  const canonicalTopics = examType === 'BECE' ? getCanonicalTopics(subject) : null

  let orderedTopicNames
  if (canonicalTopics) {
    orderedTopicNames = canonicalTopics
  } else {
    const topicAgg = await Question.aggregate([
      { $match: { subject, examType, isActive: true } },
      { $group: { _id: '$topic', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    orderedTopicNames = topicAgg.map(t => t._id)
  }

  const masteryProfiles = await MasteryProfile.find({
    studentId: req.user._id,
    subject,
  }).lean()
  const masteryMap = masteryProfiles.reduce((map, m) => {
    map[m.topic] = m
    return map
  }, {})

  // A canonical (curriculum-derived) topic name doesn't always have a
  // matching question in the bank yet — real content coverage lags the
  // syllabus for most BECE subjects. Cross-check against what's actually
  // fetchable so the UI can tell "no questions yet" apart from "locked".
  const bankTopicAgg = await Question.aggregate([
    { $match: { subject, examType, isActive: true } },
    { $group: { _id: '$topic', count: { $sum: 1 } } },
  ])
  const bankTopicCounts = bankTopicAgg.reduce((map, t) => {
    map[t._id] = t.count
    return map
  }, {})

  const now = new Date()
  let previousScore = 0
  let sawContentSession = false

  const sessions = orderedTopicNames.map((topic, index) => {
    const m = masteryMap[topic]
    const score = m?.score || 0
    const questionCount = bankTopicCounts[topic] || 0
    // Progression only advances past sessions that actually have
    // questions — otherwise a single content gap would permanently
    // "lock" every topic that comes after it in the syllabus order.
    const unlocked = !sawContentSession || previousScore >= UNLOCK_THRESHOLD
    if (questionCount > 0) {
      previousScore = score
      sawContentSession = true
    }

    return {
      sessionNumber: index + 1,
      topic,
      score,
      stars:      scoreToStars(score),
      attempted:  !!m,
      reviewDue:  !!(m?.nextReviewDate && m.nextReviewDate <= now),
      unlocked,
      questionCount,
    }
  })

  res.json({
    success: true,
    subject,
    examType,
    isCurriculumOrdered: !!canonicalTopics,
    sessions,
  })
})

// ── GET /api/practice/topics/search ────────────────────────────
// Cross-subject topic search for the command palette (⌘K) — finds
// matching topics across every subject for the student's exam type,
// so they can jump straight into a practice session for that topic.
export const searchTopics = asyncHandler(async (req, res) => {
  const { q = '' } = req.query
  const examType = resolveExamType(req, req.query.examType)

  const query = q.trim()
  if (!query) return res.json({ success: true, topics: [] })

  // Escape regex metacharacters — this is user input going straight
  // into a $regex match.
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const topics = await Question.aggregate([
    {
      $match: {
        examType,
        isActive: true,
        topic: { $regex: escaped, $options: 'i' },
      },
    },
    {
      $group: {
        _id:   { subject: '$subject', topic: '$topic' },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ])

  res.json({
    success: true,
    topics: topics.map(t => ({
      subject: t._id.subject,
      topic:   t._id.topic,
      count:   t.count,
    })),
  })
})

// ── POST /api/practice/submit ──────────────────────────────────
// Student submits a single answer.
// Marks it, updates mastery profile, returns result.
export const submitAnswer = asyncHandler(async (req, res) => {
  const {
    questionId,
    studentAnswer,
    timeTaken = 0,
    wasScanned = false,
    scannedFiles = [],
  } = req.body

  if (!questionId || studentAnswer === undefined) {
    throw new AppError('questionId and studentAnswer are required', 400)
  }

  // ── Fetch the question ─────────────────────────────────────
  const question = await Question.findById(questionId)
  if (!question) throw new AppError('Question not found', 404)

  // ── Mark the answer ────────────────────────────────────────
  let markingResult

  if (question.type === 'MCQ') {
    markingResult = markMCQ(studentAnswer, question.correctOption, question.marks)
  } else {
    markingResult = await markEssay(question, studentAnswer, question.subject)
  }

  // ── Update mastery profile ─────────────────────────────────
  const currentMastery = await MasteryProfile.findOne({
    studentId: req.user._id,
    subject:   question.subject,
    topic:     question.topic,
  })

  const masteryState = currentMastery || {
    score:                0,
    difficulty:           2,
    consecutiveCorrect:   0,
    consecutiveIncorrect: 0,
    totalAttempts:        0,
    correctAttempts:      0,
    leitnerBox:           0,
    nextReviewDate:       null,
  }

  const newMastery = computeMasteryUpdate(
    masteryState,
    markingResult.isCorrect,
    markingResult.marksAwarded,
    markingResult.marksAvailable
  )

  // Upsert the mastery profile
  await MasteryProfile.findOneAndUpdate(
    {
      studentId: req.user._id,
      subject:   question.subject,
      topic:     question.topic,
    },
    {
      $set: {
        examType:             question.examType,
        score:                newMastery.score,
        difficulty:           newMastery.difficulty,
        consecutiveCorrect:   newMastery.consecutiveCorrect,
        consecutiveIncorrect: newMastery.consecutiveIncorrect,
        leitnerBox:           newMastery.leitnerBox,
        nextReviewDate:       newMastery.nextReviewDate,
        lastPracticed:        new Date(),
      },
      $inc: {
        totalAttempts:   1,
        correctAttempts: markingResult.isCorrect ? 1 : 0,
      },
    },
    { upsert: true, new: true }
  )

  // ── Update user totals ─────────────────────────────────────
  await User.findByIdAndUpdate(req.user._id, {
    $inc: {
      totalQuestionsAnswered: 1,
      totalCorrect:           markingResult.isCorrect ? 1 : 0,
    },
    lastActive: new Date(),
  })

  res.json({
    success: true,
    result: {
      ...markingResult,
      questionId,
      // Echoed straight back so the client's accumulated results[]
      // (sent to saveSession below) carries these through to the
      // Session document without the client having to merge them in
      // separately — see questionResultSchema in Session.model.js.
      wasScanned:    !!wasScanned,
      scannedFiles:  wasScanned ? scannedFiles : [],
      // Echoed for the same reason: without these the saved Session has
      // no record of what was answered or what kind of question it was
      // (needed for reviewing marking quality), and the Explain button
      // was sending an empty studentAnswer to the AI.
      studentAnswer: typeof studentAnswer === 'string' ? studentAnswer : String(studentAnswer ?? ''),
      type:          question.type,
      difficulty:    question.difficulty,
      topic:         question.topic,
      subject:       question.subject,
      correctAnswer: question.type === 'MCQ' ? question.correctOption : null,
      explainToken:  generateExplainToken(req.user._id, questionId),
      masteryUpdate: {
        topic:        question.topic,
        oldScore:     masteryState.score,
        newScore:     newMastery.score,
        oldDifficulty: masteryState.difficulty,
        newDifficulty: newMastery.difficulty,
      },
    },
  })
})

// ── POST /api/practice/explain ─────────────────────────────────
// Student requests an AI explanation for a question they answered.
// Called on demand — not automatically after every answer. Requires
// the explainToken submitAnswer returned for this question, since an
// explanation reveals the correct answer.
export const getExplanation = asyncHandler(async (req, res) => {
  const { questionId, studentAnswer, isCorrect, explainToken } = req.body

  if (!isValidExplainToken(explainToken, req.user._id, questionId)) {
    throw new AppError('Answer this question before asking for its explanation.', 403)
  }

  const question = await Question.findById(questionId)
  if (!question) throw new AppError('Question not found', 404)

  const explanation = await generateExplanation(
    question,
    studentAnswer,
    isCorrect,
    question.subject
  )

  res.json({ success: true, explanation })
})

// ── POST /api/practice/session ─────────────────────────────────
// Saves the completed session to MongoDB at the end of practice.
// Called once when student finishes or exits a session.
export const saveSession = asyncHandler(async (req, res) => {
  const {
    subject,
    topic,
    questions,
    totalMarks,
    availableMarks,
    duration,
    masteryUpdates,
  } = req.body
  const examType = resolveExamType(req, req.body.examType)

  const accuracy = availableMarks > 0
    ? Math.round((totalMarks / availableMarks) * 100)
    : 0

  const gradeInfo = calculateGrade(totalMarks, availableMarks, examType)

  const session = await Session.create({
    studentId:     req.user._id,
    sessionType:   'practice',
    subject,
    topic:         topic || 'Mixed',
    examType,
    questions:     questions || [],
    totalMarks:    totalMarks || 0,
    availableMarks: availableMarks || 0,
    accuracy,
    duration:      duration || 0,
    masteryUpdates: masteryUpdates || [],
    waecGrade:     gradeInfo.grade,
  })

  await updateStreak(req.user._id)
  const newBadges = getBadgeDetails(await checkAndAwardBadges(req.user._id))

  res.status(201).json({
    success:   true,
    message:   'Session saved',
    sessionId: session._id,
    accuracy,
    grade:     gradeInfo,
    newBadges,          // ← add this line
  })
})

// ── GET /api/practice/mastery ──────────────────────────────────
// Returns the student's full mastery profile for a subject.
// Used by the dashboard analytics and practice topic picker.
export const getMasteryProfile = asyncHandler(async (req, res) => {
  const { subject } = req.query
  const examType = resolveExamType(req, req.query.examType)
  if (!subject) throw new AppError('Subject is required', 400)

  const profiles = await MasteryProfile.find({
    studentId: req.user._id,
    subject,
    examType,
  }).lean()

  // Calculate overall subject mastery as average of topic scores
  const overallScore = profiles.length > 0
    ? Math.round(profiles.reduce((sum, p) => sum + p.score, 0) / profiles.length)
    : 0

  res.json({
    success: true,
    subject,
    overallScore,
    topicsAttempted: profiles.length,
    profiles,
  })
})

// ── GET /api/practice/sessions ─────────────────────────────────
// Returns a student's recent practice sessions for analytics.
export const getRecentSessions = asyncHandler(async (req, res) => {
  const { limit = 10, subject } = req.query

  const filter = { studentId: req.user._id, sessionType: 'practice' }
  if (subject) filter.subject = subject

  const sessions = await Session.find(filter)
    .sort({ createdAt: -1 })
    .limit(Number(limit))
    .select('subject topic accuracy totalMarks availableMarks duration waecGrade createdAt')
    .lean()

  res.json({ success: true, sessions })
})