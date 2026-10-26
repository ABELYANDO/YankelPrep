// ── Topic prediction hold-out evaluation (thesis Section 3.5.3) ──────
// Rolling-origin test of the real prediction engine. For each subject
// and each target year t, the engine is run on past-paper questions from
// years BEFORE t only, with its reference year set to t — exactly the
// prediction it would have made just before the year-t examination — and
// its ranking is saved next to the topics that year-t paper actually
// examined. The year-t paper is never used to make its own prediction.
//
// BECE: only current-curriculum papers count (2024 onwards, matching
// prediction.controller.js), so a BECE target year needs at least one
// earlier current-curriculum year to train on.
//
// Usage (from server/):
//   npm run eval:predictions
//   npm run eval:predictions -- --examType=WASSCE --lastN=3
//   npm run eval:predictions -- --subjects="Mathematics,Social Studies" --targets=2023,2024,2025
//
// Options:
//   --examType  WASSCE or BECE (default: both)
//   --subjects  comma-separated subject names (default: every subject with past papers)
//   --targets   comma-separated target years (default: the --lastN most recent eligible years)
//   --lastN     how many recent target years per subject (default 3)
//   --includePreReform  exploratory: let pre-2024 BECE papers count as history
//   --outFile   output file name in output/ (default prediction_cases.json)
//   --fromJson  read active questions from a JSON file (an array of
//               question records with subject, examType, year, topic,
//               questionSource, ...) instead of connecting to MongoDB —
//               e.g. a copy downloaded through the app's own API
//
// Writes scripts/evaluation/output/prediction_cases.json, which
// analyze_predictions.py turns into the Chapter 4 metrics and tests.

import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import mongoose from 'mongoose'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../../.env') })

const args = {}
process.argv.slice(2).forEach(arg => {
  // --key=value, or a bare --flag (stored as '')
  const match = arg.match(/^--([^=]+)(?:=(.*))?$/)
  if (match) args[match[1]] = match[2] ?? ''
})

const MONGODB_URI = process.env.MONGODB_URI
if (!args.fromJson && !MONGODB_URI) {
  console.error('\n❌ MONGODB_URI is missing from your .env file (or pass --fromJson=<file>)\n')
  process.exit(1)
}

const { default: Question } = await import('../../src/models/Question.model.js')
const { analyseTopics } = await import('../../src/utils/predictionEngine.js')
const { BECE_CURRICULUM_REFORM_YEAR } = await import('../../src/data/beceCurriculum.js')

// Same minimum the live endpoint enforces before it will predict.
const MIN_TRAINING_QUESTIONS = 5
const OUT_DIR = join(__dirname, 'output')

// Question source: MongoDB, or a JSON copy of the active bank. Both apply
// the live endpoint's filter — active, pastPaper, and for BECE only the
// current curriculum (prediction.controller.js).
const jsonBank = args.fromJson
  ? JSON.parse(readFileSync(args.fromJson, 'utf8').replace(/^﻿/, ''))
      .filter(q => q.isActive !== false && q.questionSource === 'pastPaper')
  : null

const listSubjects = async (examType) => jsonBank
  ? [...new Set(jsonBank.filter(q => q.examType === examType).map(q => q.subject))]
  : Question.distinct('subject', { examType, isActive: true, questionSource: 'pastPaper' })

// --includePreReform: exploratory sensitivity run that also lets BECE
// papers from before the 2024 curriculum reform count as history. The
// live engine never does this; it only shows what a longer history
// would change.
const includePreReform = args.includePreReform === 'true' || args.includePreReform === ''

const loadQuestions = async (examType, subject) => {
  const minYear = examType === 'BECE' && !includePreReform ? BECE_CURRICULUM_REFORM_YEAR : -Infinity
  if (jsonBank) {
    return jsonBank.filter(q => q.examType === examType && q.subject === subject && q.year >= minYear)
  }
  const filter = { subject, examType, isActive: true, questionSource: 'pastPaper' }
  if (Number.isFinite(minYear)) filter.year = { $gte: minYear }
  return Question.find(filter).select('topic year type section difficulty').lean()
}
const examTypes = args.examType ? [args.examType] : ['WASSCE', 'BECE']
const subjectFilter = args.subjects ? args.subjects.split(',').map(s => s.trim()) : null
const targetFilter = args.targets ? args.targets.split(',').map(Number) : null
const lastN = Number(args.lastN) || 3

// Topics are compared case- and whitespace-insensitively. BECE labels are
// already snapped to the canonical NaCCA list during extraction, so this
// only needs to absorb cosmetic differences.
const topicKey = (t) => String(t || '').trim().toLowerCase()

// Frequency baseline (thesis Section 3.5.4): rank by number of distinct
// years examined, ties broken by most recent appearance, then by name.
const frequencyRanking = (questions) => {
  const byTopic = new Map()
  for (const q of questions) {
    const k = topicKey(q.topic)
    if (!byTopic.has(k)) byTopic.set(k, { topic: q.topic, years: new Set() })
    byTopic.get(k).years.add(q.year)
  }
  return [...byTopic.values()]
    .map(t => ({ topic: t.topic, years: t.years.size, latest: Math.max(...t.years) }))
    .sort((a, b) => b.years - a.years || b.latest - a.latest || a.topic.localeCompare(b.topic))
    .map(t => t.topic)
}

// Share of a set of questions that falls on each topic — used for the
// exploratory "topic emphasis" analysis (does a ranking predict how many
// questions a topic gets, not just whether it appears?).
const topicShares = (questions) => {
  const counts = {}
  for (const q of questions) counts[topicKey(q.topic)] = (counts[topicKey(q.topic)] || 0) + 1
  return Object.fromEntries(Object.entries(counts).map(([k, c]) => [k, c / questions.length]))
}

const run = async () => {
  if (!jsonBank) await mongoose.connect(MONGODB_URI)

  const cases = []
  const skipped = []

  for (const examType of examTypes) {
    const subjects = subjectFilter || await listSubjects(examType)

    for (const subject of subjects.sort()) {
      const questions = await loadQuestions(examType, subject)

      const years = [...new Set(questions.map(q => q.year))].sort((a, b) => a - b)
      // A target year needs at least one earlier year to learn from.
      const eligible = years.filter(y => years.some(prior => prior < y))
      const targets = targetFilter
        ? eligible.filter(y => targetFilter.includes(y))
        : eligible.slice(-lastN)

      for (const target of targets) {
        const train = questions.filter(q => q.year < target)
        const test  = questions.filter(q => q.year === target)

        if (train.length < MIN_TRAINING_QUESTIONS) {
          skipped.push({ examType, subject, target, reason: `only ${train.length} training questions` })
          continue
        }

        const ranked = analyseTopics(train, subject, examType, { referenceYear: target })
        const lastTrainYear = Math.max(...train.map(q => q.year))
        cases.push({
          examType,
          subject,
          targetYear:      target,
          includePreReform,
          trainYears:      [...new Set(train.map(q => q.year))].sort((a, b) => a - b),
          trainQuestions:  train.length,
          testQuestions:   test.length,
          ranked:          ranked.map(t => ({ topic: t.topic, key: topicKey(t.topic), confidence: t.confidence,
                                              tier: t.tier, rawScore: t.rawScore })),
          shares: {
            target:        topicShares(test),
            lastTrainYear: topicShares(train.filter(q => q.year === lastTrainYear)),
            train:         topicShares(train),
          },
          frequencyRanked: frequencyRanking(train).map(t => ({ topic: t, key: topicKey(t) })),
          actualTopics:    [...new Map(test.map(q => [topicKey(q.topic), q.topic])).entries()]
                             .map(([key, topic]) => ({ topic, key })),
        })
        console.log(`✓ ${examType} ${subject} ${target}: ${ranked.length} topics ranked, ` +
                    `${new Set(test.map(q => topicKey(q.topic))).size} examined`)
      }
    }
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const outPath = join(OUT_DIR, args.outFile || 'prediction_cases.json')
  writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), cases, skipped }, null, 2))

  console.log(`\n${cases.length} case(s) evaluated, ${skipped.length} skipped`)
  skipped.forEach(s => console.log(`  skipped ${s.examType} ${s.subject} ${s.target}: ${s.reason}`))
  console.log(`Saved: ${outPath}`)
  console.log('Next: python scripts/evaluation/analyze_predictions.py\n')
  if (!jsonBank) await mongoose.disconnect()
}

run().catch(err => {
  console.error('\n❌ Fatal error:', err)
  process.exit(1)
})
