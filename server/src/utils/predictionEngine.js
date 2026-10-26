// ── predictionEngine.js ────────────────────────────────────────
// Pure scoring functions. Takes question data, returns topic scores.
// No side effects — same input always produces same output.

import { getCanonicalTopics } from '../data/beceCurriculum.js'
import { normalizeTopic } from './questionExtraction.utils.js'

// Years of same-curriculum history before frequency/recency/gap are
// fully trusted. Below this, scoring leans on the real syllabus
// signal instead — see freqTrust in analyseTopics/scoreOneTopic.
const MATURE_YEARS = 5

// ── Subject-specific score weights ────────────────────────────
// Different subjects have different predictability patterns.
// Mathematics topics cycle predictably → gap score matters more.
// English Language themes shift with current events → recency matters more.
const SUBJECT_WEIGHTS = {
  'Mathematics': {
    frequency: 0.25, recency: 0.25, gap: 0.25, syllabus: 0.25,
  },
  'English Language': {
    frequency: 0.20, recency: 0.35, gap: 0.15, syllabus: 0.30,
  },
  'Integrated Science': {   // WASSCE only — BECE now uses 'Science'
    frequency: 0.30, recency: 0.25, gap: 0.20, syllabus: 0.25,
  },
  'Science': {              // BECE only — same predictability pattern, new name
    frequency: 0.30, recency: 0.25, gap: 0.20, syllabus: 0.25,
  },
  'Social Studies': {
    frequency: 0.25, recency: 0.30, gap: 0.15, syllabus: 0.30,
  },
  // Default weights for all other subjects
  default: {
    frequency: 0.25, recency: 0.25, gap: 0.25, syllabus: 0.25,
  },
}

// ── Main export ────────────────────────────────────────────────
// Receives all questions for one subject, returns scored topic array
// sorted from highest to lowest predicted confidence.
//
// `referenceYear` is the year the prediction is made for — recency,
// gap, trend and the sparkline window are all measured back from it.
// Live predictions use the current year; the hold-out evaluation
// (scripts/evaluatePredictions.js) sets it to the held-out paper's
// year, so a paper is predicted exactly as it would have been then.
export const analyseTopics = (questions, subject, examType, { referenceYear } = {}) => {
  const refYear = referenceYear ?? new Date().getFullYear()

  // Real syllabus signal only applies to BECE — Question.subject values
  // like 'Mathematics'/'Computing' are shared with WASSCE, so this must
  // gate on examType, not just whether a canonical list exists for the
  // subject name, or a WASSCE subject would get scored against the JHS
  // BECE topic list.
  const canonicalTopics = examType === 'BECE' ? getCanonicalTopics(subject) : null

  // How many distinct years of (already era-filtered, for BECE) data
  // exist for this subject overall — drives how much weight shifts from
  // frequency/recency/gap onto the syllabus signal while the sample is
  // thin. Irrelevant when there's no real syllabus signal to shift onto.
  const datasetYears = [...new Set(questions.map(q => q.year))]
  const freqTrust = canonicalTopics
    ? Math.min(datasetYears.length / MATURE_YEARS, 1)
    : 1

  // Step 1: Group all questions by topic
  const topicMap = groupByTopic(questions)

  // Step 2: Score each topic across all 8 signals
  const scored = Object.entries(topicMap).map(([topic, qs]) => {
    return scoreOneTopic(topic, qs, subject, topicMap, canonicalTopics, freqTrust, refYear)
  })

  // Step 3: Sort highest raw score first
  scored.sort((a, b) => b.rawScore - a.rawScore)

  // Step 4: Normalise raw scores to 0–100 confidence scale
  return normaliseConfidence(scored)
}

// ── Step 1: Group questions by topic ──────────────────────────
const groupByTopic = (questions) => {
  return questions.reduce((map, q) => {
    if (!map[q.topic]) map[q.topic] = []
    map[q.topic].push(q)
    return map
  }, {})
}

// ── Real syllabus signal ────────────────────────────────────────
// Checks whether a topic matches the canonical NaCCA CCP taxonomy for
// this subject, reusing the same fuzzy matcher already used to keep
// AI-extracted topic labels consistent (questionExtraction.utils.js).
// Returns null when there's no canonical list to check against — the
// caller falls back to the frequency proxy in that case.
const computeSyllabusSignal = (topic, canonicalTopics) => {
  if (!canonicalTopics) return null
  const { topicNeedsReview } = normalizeTopic(topic, canonicalTopics)
  return topicNeedsReview ? 0.3 : 1
}

// ── Step 2: Score one topic ────────────────────────────────────
const scoreOneTopic = (topic, questions, subject, allTopics, canonicalTopics, freqTrust, refYear) => {
  const years     = [...new Set(questions.map(q => q.year))].sort()
  const latestYear = Math.max(...years)
  const weights   = SUBJECT_WEIGHTS[subject] || SUBJECT_WEIGHTS.default

  // Signal 1 — Frequency (normalised 0–1 over 10 years)
  // How many distinct years did this topic appear in?
  const frequencyScore = Math.min(years.length / 10, 1)

  // Signal 2 — Recency (exponential decay: recent years worth more)
  // A topic seen in 2024 scores higher than one seen in 2016.
  const recencyScore = years.reduce((sum, yr) => {
    const age    = refYear - yr              // how many years ago
    const weight = Math.exp(-age * 0.15)     // decay factor: older = lower
    return sum + weight
  }, 0) / years.length

  // Signal 3 — Gap score (how many years since last appearance)
  // A topic absent for 3+ years is "due" to return.
  const yearsSinceLastSeen = refYear - latestYear
  // Gap score peaks at 3 years then plateaus — extreme gaps are less reliable
  const gapScore = Math.min(yearsSinceLastSeen / 3, 1)

  // Signal 4 — Trend direction
  // Compare frequency in first half vs second half of the 10-year window
  const midYear   = refYear - 5
  const earlyCount = years.filter(y => y <= midYear).length
  const recentCount = years.filter(y => y > midYear).length
  // Returns -1 (falling), 0 (stable), or +1 (rising)
  const trendDirection = recentCount > earlyCount ? 1
                       : recentCount < earlyCount ? -1 : 0

  // Signal 5 — Year-on-year data (for sparkline chart on the UI)
  const yearlyFrequency = buildYearlyFrequency(questions, refYear)

  // Signal 6 — Section type prediction
  // What section does this topic most commonly appear in?
  const sectionForecast = predictSection(questions)

  // Signal 7 — Topic clusters
  // Which topics appear in the same years as this one?
  const clusters = findClusters(topic, years, allTopics)

  // Signal 8 — Difficulty trend
  // Is the examiner setting harder or easier questions on this topic?
  const avgDifficulty = questions.reduce((s, q) => s + q.difficulty, 0) / questions.length
  const difficultyTrend = avgDifficulty > 3.5 ? 'increasing'
                        : avgDifficulty < 2.5 ? 'decreasing' : 'stable'

  // ── Weighted raw score (0–1 scale) ──────────────────────────
  // Syllabus signal uses the real NaCCA topic taxonomy where one
  // exists (BECE only — see canonicalTopics in analyseTopics), falling
  // back to frequency as a proxy for every other subject/exam type.
  const realSignal   = computeSyllabusSignal(topic, canonicalTopics)
  const syllabusProxy = realSignal ?? frequencyScore

  // When a real syllabus signal is available but the same-curriculum
  // sample is still thin (freqTrust < 1), redistribute weight from
  // frequency/recency/gap onto syllabus in proportion to the trust
  // deficit — a topic seen in only 1 post-reform year leans almost
  // entirely on "is this actually in the current curriculum" rather
  // than a frequency count that's structurally low just for lack of
  // years. As more years accumulate, freqTrust → 1 and this converges
  // back to the subject's normal weights automatically.
  let effectiveWeights = weights
  if (realSignal !== null && freqTrust < 1) {
    const deficit = (1 - freqTrust) * (weights.frequency + weights.recency + weights.gap)
    effectiveWeights = {
      frequency: weights.frequency * freqTrust,
      recency:   weights.recency   * freqTrust,
      gap:       weights.gap       * freqTrust,
      syllabus:  weights.syllabus + deficit,
    }
  }

  const rawScore =
    (frequencyScore * effectiveWeights.frequency) +
    (recencyScore   * effectiveWeights.recency)   +
    (gapScore       * effectiveWeights.gap)       +
    (syllabusProxy  * effectiveWeights.syllabus)

  // Trend direction boosts or penalises the raw score slightly
  const trendBoost = trendDirection * 0.05
  const finalRaw   = Math.max(0, Math.min(1, rawScore + trendBoost))

  return {
    topic,
    rawScore:        finalRaw,
    confidence:      0,          // filled in by normaliseConfidence()
    tier:            '',         // filled in after confidence is set
    frequencyScore:  Math.round(frequencyScore * 100),
    recencyScore:    Math.round(recencyScore   * 100),
    gapScore:        Math.round(gapScore       * 100),
    trendDirection,              // -1, 0, or 1
    yearlyFrequency,             // array of { year, count } for sparkline
    sectionForecast,             // { questionType, section, expectedMarks, confidence }
    clusters,                    // array of related topic names
    difficultyTrend,             // 'increasing', 'stable', 'decreasing'
    yearsAppeared:   years,
    latestYear,
    totalQuestions:  questions.length,
    lastSeen:        latestYear,
  }
}

// ── Yearly frequency (sparkline data) ─────────────────────────
const buildYearlyFrequency = (questions, refYear) => {
  const countByYear = questions.reduce((map, q) => {
    map[q.year] = (map[q.year] || 0) + 1
    return map
  }, {})

  // Return last 10 years as a sorted array
  const startYear = refYear - 10
  return Array.from({ length: 10 }, (_, i) => {
    const year = startYear + i + 1
    return { year, count: countByYear[year] || 0 }
  })
}

// ── Section type prediction ────────────────────────────────────
const predictSection = (questions) => {
  // Count how often each type appears for this topic
  const counts = questions.reduce((map, q) => {
    const key = `${q.type}|${q.section}`
    map[key] = (map[key] || 0) + 1
    return map
  }, {})

  // Find the most common type+section combination
  const mostCommon = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)[0]

  if (!mostCommon) return null

  const [typeSection] = mostCommon
  const [type, section] = typeSection.split('|')

  // Estimate marks based on section
  const marksMap = { A: 1, B: 10, C: 20 }

  return {
    // Named questionType, not type — a field literally named `type`
    // inside a Mongoose nested-object schema gets misparsed as the
    // field's own SchemaType declaration instead of nested data.
    questionType:  type,
    section:       section || 'A',
    expectedMarks: marksMap[section] || 1,
    confidence:    Math.round((mostCommon[1] / questions.length) * 100),
  }
}

// ── Topic cluster detection ────────────────────────────────────
// Finds topics that appeared in the same years as this topic.
// Co-occurrence suggests they may be tested together.
const findClusters = (currentTopic, currentYears, allTopics) => {
  const yearSet = new Set(currentYears)
  const clusters = []

  for (const [topic, questions] of Object.entries(allTopics)) {
    if (topic === currentTopic) continue

    const otherYears = [...new Set(questions.map(q => q.year))]
    const overlap    = otherYears.filter(y => yearSet.has(y)).length

    // If this topic appeared in 50%+ of the same years, it's a cluster
    if (overlap / currentYears.length >= 0.5) {
      clusters.push(topic)
    }
  }

  // Return top 3 most relevant cluster topics
  return clusters.slice(0, 3)
}

// ── Normalise scores to 0–100 confidence ──────────────────────
// Scales the highest raw score to ~95% and others proportionally.
// Then assigns hot/warm/watch tiers.
const normaliseConfidence = (scored) => {
  if (scored.length === 0) return []

  const maxRaw = scored[0].rawScore

  return scored.map(topic => {
    // Scale to a 0–95 range (leaving room — 100% would be misleading)
    const confidence = maxRaw > 0
      ? Math.round((topic.rawScore / maxRaw) * 95)
      : 0

    const tier = confidence >= 70 ? 'hot'
               : confidence >= 45 ? 'warm'
               : 'watch'

    return { ...topic, confidence, tier }
  })
}