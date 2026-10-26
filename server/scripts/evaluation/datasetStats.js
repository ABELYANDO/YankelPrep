// ── Question bank statistics (thesis Chapter 4, first results table) ──
// Counts the question bank by exam type and subject: questions in use,
// how many are real past-paper evidence vs supplementary practice, MCQ vs
// Essay, the year range and number of distinct years, distinct topics,
// and how many extracted questions are still waiting in the review queue.
//
// Usage (from server/):
//   npm run eval:dataset
//
// Writes scripts/evaluation/output/dataset_stats.csv and prints a table.

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

const { default: Question } = await import('../../src/models/Question.model.js')
const { toCsv } = await import('./csv.js')

const OUT_DIR = join(__dirname, 'output')

const run = async () => {
  await mongoose.connect(MONGODB_URI)

  const rows = await Question.aggregate([
    {
      $group: {
        _id: { examType: '$examType', subject: '$subject' },
        active:        { $sum: { $cond: ['$isActive', 1, 0] } },
        pendingReview: { $sum: { $cond: ['$pendingReview', 1, 0] } },
        pastPaper: { $sum: { $cond: [{ $and: ['$isActive', { $ne: ['$questionSource', 'practice'] }] }, 1, 0] } },
        practice:  { $sum: { $cond: [{ $and: ['$isActive', { $eq: ['$questionSource', 'practice'] }] }, 1, 0] } },
        mcq:       { $sum: { $cond: [{ $and: ['$isActive', { $eq: ['$type', 'MCQ'] }] }, 1, 0] } },
        essay:     { $sum: { $cond: [{ $and: ['$isActive', { $eq: ['$type', 'Essay'] }] }, 1, 0] } },
        withDiagram: { $sum: { $cond: [{ $and: ['$isActive', '$hasImage'] }, 1, 0] } },
        // Years and topics are counted over active past-paper questions
        // only — the same evidence the prediction engine uses.
        years:  { $addToSet: { $cond: [{ $and: ['$isActive', { $ne: ['$questionSource', 'practice'] }] }, '$year', '$$REMOVE'] } },
        topics: { $addToSet: { $cond: ['$isActive', '$topic', '$$REMOVE'] } },
      },
    },
    { $sort: { '_id.examType': 1, '_id.subject': 1 } },
  ])

  const table = rows.map(r => {
    const years = r.years.filter(y => y != null).sort((a, b) => a - b)
    return {
      exam_type:       r._id.examType,
      subject:         r._id.subject,
      active:          r.active,
      past_paper:      r.pastPaper,
      practice:        r.practice,
      mcq:             r.mcq,
      essay:           r.essay,
      with_diagram:    r.withDiagram,
      first_year:      years[0] ?? '',
      last_year:       years[years.length - 1] ?? '',
      distinct_years:  years.length,
      distinct_topics: r.topics.length,
      pending_review:  r.pendingReview,
    }
  })

  // Totals per exam type, then overall.
  const sumRows = (label, subset) => {
    const firsts = subset.map(r => r.first_year).filter(Number.isFinite)
    const lasts  = subset.map(r => r.last_year).filter(Number.isFinite)
    return {
      exam_type: label, subject: 'All subjects',
      ...Object.fromEntries(['active', 'past_paper', 'practice', 'mcq', 'essay', 'with_diagram', 'pending_review']
        .map(k => [k, subset.reduce((s, r) => s + r[k], 0)])),
      first_year: firsts.length ? Math.min(...firsts) : '',
      last_year:  lasts.length  ? Math.max(...lasts)  : '',
      distinct_years: '', distinct_topics: '',
    }
  }
  const totals = [...new Set(table.map(r => r.exam_type))].map(et => sumRows(et, table.filter(r => r.exam_type === et)))
  totals.push(sumRows('Total', table))
  const all = [...table, ...totals]

  mkdirSync(OUT_DIR, { recursive: true })
  const outPath = join(OUT_DIR, 'dataset_stats.csv')
  writeFileSync(outPath, toCsv(all))

  console.table(all)
  console.log(`\nSaved: ${outPath}\n`)
  await mongoose.disconnect()
}

run().catch(err => {
  console.error('\n❌ Fatal error:', err)
  process.exit(1)
})
