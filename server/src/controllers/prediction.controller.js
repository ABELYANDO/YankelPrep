import Question   from '../models/Question.model.js'
import Prediction from '../models/Prediction.model.js'
import { analyseTopics }    from '../utils/predictionEngine.js'
import { generateAIJSON, generateAIResponse } from '../utils/aiService.js'
import { asyncHandler, AppError } from '../middleware/error.middleware.js'
import { resolveExamType } from '../utils/examType.utils.js'
import { BECE_CURRICULUM_REFORM_YEAR } from '../data/beceCurriculum.js'

// ── Cache duration in milliseconds (7 days) ───────────────────
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000

// Same threshold predictionEngine.js uses to decide how much weight
// the real syllabus signal should carry — reused here to tell the
// client honestly when a BECE prediction rests on a thin sample.
const MATURE_YEARS = 5

// ── GET /api/predictions/:subject?examType=WASSCE ──────────────
// Returns predictions for one subject.
// Serves from cache if fresh — runs engine + AI if stale or missing.
// Students are locked to their own exam type; admins can request either.
export const getPredictions = asyncHandler(async (req, res) => {
  const { subject }  = req.params
  // Query values are strings — the client sends forceRefresh=false on every
  // normal page load, and the string 'false' is truthy, so a plain
  // destructure made every visit regenerate (≈20 s and an AI call) instead
  // of serving the cache. Only an explicit 'true' forces a refresh.
  const forceRefresh = req.query.forceRefresh === 'true'
  const examType = resolveExamType(req, req.query.examType)

  // 1. Check cache first
  const cached = await Prediction.findOne({ subject, examType })
  const isFresh = cached &&
    (Date.now() - new Date(cached.generatedAt).getTime()) < CACHE_TTL

  // Never auto-generate — that costs a real AI call. Without an explicit
  // forceRefresh, serve whatever's cached (fresh or stale) or tell the
  // client nothing has been generated yet so it can offer that as an
  // explicit action instead.
  if (!forceRefresh) {
    if (cached) {
      return res.json({
        success:        true,
        fromCache:      true,
        stale:          !isFresh,
        generatedAt:    cached.generatedAt,
        cacheExpiresAt: new Date(new Date(cached.generatedAt).getTime() + CACHE_TTL),
        subject,
        examType,
        predictions: cached.predictions,
        totalQuestionsAnalysed: cached.totalQuestionsAnalysed,
        dataMaturity: cached.dataMaturity,
      })
    }

    return res.json({
      success:        true,
      fromCache:      false,
      notGenerated:   true,
      generatedAt:    null,
      cacheExpiresAt: null,
      subject,
      examType,
      predictions:    [],
      totalQuestionsAnalysed: 0,
      dataMaturity:   null,
    })
  }

  // 2. forceRefresh === true — explicit request, always (re)generate
  //    regardless of cache freshness. Run the full engine.
  // Only real historical exam questions count as prediction evidence —
  // admin-added practice/supplementary content (AI-generated, or
  // explicitly marked as such) is fully usable for practice/mock exams
  // but must never blend into the statistical signals.
  const questionFilter = { subject, examType, isActive: true, questionSource: 'pastPaper' }

  // BECE is examined against a new NaCCA curriculum from 2024 onward —
  // pre-reform past questions test a retired syllabus and must never be
  // blended into the statistical signals, so they're excluded here
  // rather than silently scored alongside current-curriculum questions.
  if (examType === 'BECE') {
    questionFilter.year = { $gte: BECE_CURRICULUM_REFORM_YEAR }
  }

  const questions = await Question.find(questionFilter).lean()  // .lean() returns plain objects — faster for data processing

  if (questions.length < 5) {
    throw new AppError(
      examType === 'BECE'
        ? `Not enough BECE past questions from the current curriculum (${BECE_CURRICULUM_REFORM_YEAR}+) for ${subject} to generate predictions. Pre-reform papers are excluded — add more recent past questions first.`
        : `Not enough questions in the bank for ${subject} to generate predictions. Add more questions first.`,
      400
    )
  }

  const distinctYears = [...new Set(questions.map(q => q.year))]
  const dataMaturity = {
    yearsAvailable: distinctYears.length,
    isThinData:     examType === 'BECE' && distinctYears.length < MATURE_YEARS,
  }

  // 3. Run all 8 scoring algorithms (pure JS — fast)
  const scoredTopics = analyseTopics(questions, subject, examType)

  // 4. Take the top 15 topics and enrich with AI reasoning
  const topTopics = scoredTopics.slice(0, 15)
  const enriched  = await enrichWithAI(
    topTopics, subject, examType, questions.length, distinctYears, dataMaturity.isThinData
  )

  // 5. Save to MongoDB (upsert — replace if exists)
  const saved = await Prediction.findOneAndUpdate(
    { subject, examType },
    {
      subject,
      examType,
      predictions:            enriched,
      generatedAt:            new Date(),
      totalQuestionsAnalysed: questions.length,
      dataMaturity,
      runBy:                  req.user._id,
    },
    { upsert: true, new: true }
  )

  res.json({
    success:        true,
    fromCache:      false,
    stale:          false,
    generatedAt:    saved.generatedAt,
    cacheExpiresAt: new Date(saved.generatedAt.getTime() + CACHE_TTL),
    subject,
    examType,
    predictions: saved.predictions,
    totalQuestionsAnalysed: questions.length,
    dataMaturity,
  })
})

// ── POST /api/predictions/accuracy ────────────────────────────
// Admin only — log real exam results to build accuracy feedback loop
export const logAccuracy = asyncHandler(async (req, res) => {
  const { subject, examType, examYear, actualTopics } = req.body

  const prediction = await Prediction.findOne({ subject, examType })
  if (!prediction) throw new AppError('No prediction found for this subject', 404)

  // Compare top predicted topics against what actually appeared
  const predictedTopics = prediction.predictions
    .filter(p => p.tier === 'hot')
    .map(p => p.topic)

  const hits = predictedTopics.filter(t =>
    actualTopics.some(actual =>
      actual.toLowerCase().includes(t.toLowerCase()) ||
      t.toLowerCase().includes(actual.toLowerCase())
    )
  )

  const accuracyPercent = predictedTopics.length > 0
    ? Math.round((hits.length / predictedTopics.length) * 100)
    : 0

  // Push to the accuracy log array
  prediction.accuracyLog.push({
    examYear,
    predictedTopics,
    actualTopics,
    accuracyPercent,
    loggedAt: new Date(),
  })

  await prediction.save()

  res.json({
    success: true,
    message: `Accuracy logged: ${accuracyPercent}% of hot predictions matched`,
    accuracyPercent,
    hits,
  })
})

// ── GET /api/predictions/history/:subject ─────────────────────
// Returns the accuracy log for a subject — admin dashboard
export const getAccuracyHistory = asyncHandler(async (req, res) => {
  const { subject }  = req.params
  const { examType = 'WASSCE' } = req.query

  const prediction = await Prediction.findOne({ subject, examType })
  if (!prediction) throw new AppError('No prediction history found', 404)

  res.json({
    success:     true,
    subject,
    accuracyLog: prediction.accuracyLog,
  })
})

// ── AI enrichment (internal — not a route) ────────────────────
// Sends scored topics to Gemini/Claude and gets back:
// - human-readable reasoning per topic
// - examiner style hint per topic
const enrichWithAI = async (topics, subject, examType, totalQs, distinctYears = [], isThinData = false) => {
  // Build a compact summary to send to the AI
  // We don't send the full question data — just the scores
  const topicSummary = topics.map(t => ({
    topic:          t.topic,
    confidence:     t.confidence,
    tier:           t.tier,
    yearsAppeared:  t.yearsAppeared,
    latestYear:     t.latestYear,
    trendDirection: t.trendDirection === 1  ? 'rising'
                  : t.trendDirection === -1 ? 'falling' : 'stable',
    sectionForecast: t.sectionForecast,
    clusters:       t.clusters,
    difficultyTrend: t.difficultyTrend,
  }))

  const systemPrompt = `You are an expert WAEC examiner and educational data analyst 
specialising in ${examType} ${subject} examinations in Ghana. 
You interpret statistical topic analysis data and produce clear, 
examiner-standard reasoning that helps students prioritise their revision.
Always respond with valid JSON only. No markdown, no explanation outside the JSON.`

  const yearSpan = distinctYears.length > 0
    ? `${Math.min(...distinctYears)}–${Math.max(...distinctYears)}`
    : `2014–${new Date().getFullYear()}`

  const thinDataNote = isThinData
    ? `\nNote: only ${distinctYears.length} year(s) of past questions exist under the current curriculum. Ground your reasoning primarily in what the topic covers in the syllabus rather than overstating confidence from a short history — it's fine to say a topic is a priority because it's a core part of the curriculum, even without years of repeat appearances.\n`
    : ''

  const prompt = `
I have analysed ${totalQs} past ${examType} ${subject} questions from ${yearSpan}.
${thinDataNote}Here are the top predicted topics with their statistical scores:

${JSON.stringify(topicSummary, null, 2)}

For each topic, generate:
1. "aiReasoning" — 2–3 sentences of examiner-standard reasoning explaining WHY this topic 
   is predicted at this confidence level. Reference the specific data (years appeared, trend, gap).
   Write as if you are an experienced WAEC tutor speaking directly to a student.

2. "examinerStyleHint" — 1 sentence describing HOW this topic has recently been tested 
   (question format, phrasing style, application vs theory, etc.)

Return ONLY a JSON array matching this exact structure:
[
  {
    "topic": "exact topic name from input",
    "aiReasoning": "...",
    "examinerStyleHint": "..."
  }
]`

  try {
    const aiResults = await generateAIJSON(prompt, systemPrompt)

    // Merge AI output back into the scored topics
    return topics.map(topic => {
      const aiData = aiResults.find(r =>
        r.topic?.toLowerCase() === topic.topic?.toLowerCase()
      )
      return {
        ...topic,
        aiReasoning:      aiData?.aiReasoning      || 'Analysis pending.',
        examinerStyleHint: aiData?.examinerStyleHint || 'Review past paper formats.',
      }
    })
  } catch (err) {
    // If AI call fails, return topics without AI enrichment
    // Engine scores are still valuable without the AI narrative
    console.error('[Prediction] AI enrichment failed:', err.message)
    return topics.map(topic => ({
      ...topic,
      aiReasoning:       'AI enrichment unavailable. Scores based on statistical analysis.',
      examinerStyleHint: 'Review recent past papers for question format.',
    }))
  }
}