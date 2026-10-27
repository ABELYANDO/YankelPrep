// ── Question bank clean-up ───────────────────────────────────────
// Finds and (with --apply) fixes data problems in the active question
// bank. By default this is a DRY RUN: it reports what it would change and
// writes the full list to scripts/evaluation/output/question_bank_fixes.csv,
// but changes nothing.
//
// Fixed automatically with --apply:
//   1. Duplicates — the same question text in the same exam + subject:
//        - past-paper copies imported twice for the SAME year
//        - practice questions duplicated, and practice copies of a
//          past-paper question
//      One copy is kept (a past-paper copy if there is one, else the
//      oldest); the others are DEACTIVATED (isActive: false), not deleted,
//      so this can be undone. The same question appearing in DIFFERENT
//      years of past papers is a genuine WAEC repeat and is left alone.
//   2. MCQ options that carry their own letters ("A-9", "B. cassava"),
//      only when all four options start A, B, C, D in order — the letter
//      (and a following "." or ")") is stripped; a minus sign is kept.
//   3. Known wrong answer keys listed in KNOWN_KEY_FIXES below.
//
// Reported only (a person must decide which number is right):
//   4. Questions whose part marks don't add up to the question's marks.
//
// Usage (from server/):
//   npm run questions:fix-issues            (dry run)
//   npm run questions:fix-issues -- --apply

import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import mongoose from 'mongoose'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

const APPLY = process.argv.includes('--apply')

// Wrong keys confirmed by hand. Matched on question text, so they still
// apply after the duplicate clean-up.
const KNOWN_KEY_FIXES = [
  {
    textIncludes: 'a^2 - (a - ab)',
    correctOption: 'B',
    reason: 'a = -3, b = 5: a^2 - (a - ab) = 9 - 12 = -3, which is option B (the key said A, -9)',
  },
]

const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const LETTERS = ['A', 'B', 'C', 'D']

// Pure planning step — exported so it can be tested without a database.
export const planFixes = (docs) => {
  const actions = []
  const byText = new Map()
  for (const q of docs) {
    const t = norm(q.questionText)
    if (t.length <= 15) continue
    const k = `${q.examType}|${q.subject}|${t}`
    if (!byText.has(k)) byText.set(k, [])
    byText.get(k).push(q)
  }
  const oldestFirst = (a, b) => String(a._id).localeCompare(String(b._id))
  for (const group of byText.values()) {
    if (group.length < 2) continue
    const past = group.filter(q => q.questionSource === 'pastPaper').sort(oldestFirst)
    const practice = group.filter(q => q.questionSource !== 'pastPaper').sort(oldestFirst)
    // Past-paper: keep one per year (different years are genuine repeats)
    const keptYears = new Set()
    for (const q of past) {
      if (keptYears.has(q.year)) actions.push({ action: 'deactivate', reason: `past-paper duplicate within ${q.year}`, q })
      else keptYears.add(q.year)
    }
    // Practice: drop copies of a past-paper question, and extra practice copies
    practice.forEach((q, i) => {
      if (past.length > 0) actions.push({ action: 'deactivate', reason: 'practice copy of a past-paper question', q })
      else if (i > 0) actions.push({ action: 'deactivate', reason: 'duplicate practice question', q })
    })
  }
  for (const q of docs) {
    const opts = q.options || []
    if (q.type === 'MCQ' && opts.length === 4 &&
        opts.every((o, i) => new RegExp(`^\\s*${LETTERS[i]}(?![A-Za-z])`).test(o || ''))) {
      const cleaned = opts.map((o, i) => o.replace(new RegExp(`^\\s*${LETTERS[i]}\\s*[.)]?\\s*`), '').trim())
      if (cleaned.every(Boolean)) actions.push({ action: 'strip option letters', reason: `${opts.join(' | ')} -> ${cleaned.join(' | ')}`, q, update: { options: cleaned } })
    }
    for (const fix of KNOWN_KEY_FIXES) {
      if ((q.questionText || '').includes(fix.textIncludes) && q.correctOption !== fix.correctOption) {
        actions.push({ action: 'fix answer key', reason: `${q.correctOption} -> ${fix.correctOption}: ${fix.reason}`, q, update: { correctOption: fix.correctOption } })
      }
    }
    if (Array.isArray(q.parts) && q.parts.length > 0) {
      const sum = q.parts.reduce((s, p) => s + (Number(p.marks) || 0), 0)
      if (sum !== q.marks) actions.push({ action: 'CHECK BY HAND', reason: `parts add up to ${sum}, question says ${q.marks}`, q })
    }
  }
  return actions
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`

const run = async () => {
  const MONGODB_URI = process.env.MONGODB_URI
  if (!MONGODB_URI) {
    console.error('\n❌ MONGODB_URI is missing from your .env file\n')
    process.exit(1)
  }
  await mongoose.connect(MONGODB_URI, { dbName: 'eduprepai' })
  // Native driver: some documents still carry the retired 'Structured' type,
  // which the Mongoose model's enum would reject.
  const col = mongoose.connection.collection('questions')
  try {
    const docs = await col.find({ isActive: true }).project({
      questionText: 1, examType: 1, subject: 1, year: 1, type: 1, questionSource: 1,
      options: 1, correctOption: 1, marks: 1, 'parts.marks': 1,
    }).toArray()
    const actions = planFixes(docs)

    const counts = actions.reduce((m, a) => ({ ...m, [a.action]: (m[a.action] || 0) + 1 }), {})
    console.log(`\nActive questions scanned: ${docs.length}`)
    Object.entries(counts).forEach(([k, v]) => console.log(`   ${k}: ${v}`))

    const outDir = join(__dirname, 'evaluation', 'output')
    mkdirSync(outDir, { recursive: true })
    const csvPath = join(outDir, 'question_bank_fixes.csv')
    const header = ['action', 'question_id', 'exam', 'subject', 'year', 'source', 'reason', 'question_text']
    writeFileSync(csvPath, '﻿' + [header.map(csvCell).join(','), ...actions.map(a => [
      a.action, a.q._id, a.q.examType, a.q.subject, a.q.year, a.q.questionSource, a.reason, (a.q.questionText || '').slice(0, 200),
    ].map(csvCell).join(','))].join('\r\n'))
    console.log(`\nFull list: ${csvPath}`)

    if (!APPLY) {
      console.log('\nDRY RUN — nothing was changed. Re-run with --apply to make these changes.\n')
      return
    }
    let changed = 0
    for (const a of actions) {
      if (a.action === 'deactivate') {
        changed += (await col.updateOne({ _id: a.q._id }, { $set: { isActive: false, deactivatedReason: a.reason } })).modifiedCount
      } else if (a.update) {
        changed += (await col.updateOne({ _id: a.q._id }, { $set: a.update })).modifiedCount
      }
    }
    console.log(`\n✅ Applied: ${changed} question(s) updated. Questions marked "CHECK BY HAND" were not changed.\n`)
  } finally {
    await mongoose.disconnect()
  }
}

// Only connect when run directly (planFixes is also imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch(err => {
    console.error('\n❌ fixQuestionBankIssues failed:', err.message)
    process.exit(1)
  })
}
