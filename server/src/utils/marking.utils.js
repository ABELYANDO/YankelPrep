import { generateAIJSON, generateAIJSONWithImages } from './aiService.js'

// Added to a marking prompt when the student's handwritten pages are
// attached. The transcription is text only, so a diagram, graph or
// table the student drew can only be marked from the pages themselves.
export const SCRIPT_IMAGES_NOTE = `

The student's handwritten script is attached as image(s)/PDF. The typed
answer above is an AI transcription of it and may describe or miss
diagrams. Read the attached pages as the authoritative answer: mark any
diagram, graph, table or sketch from the pages (accuracy, labels,
units, neatness where the marking guide rewards it), and do not treat a
diagram as missing just because the transcription lacks it.`

// Uses the vision-capable call only when there are pages to look at,
// falling back to the transcription alone if that call fails, so a bad
// or oversized photo never turns into a mark of zero.
const markWithAI = async (prompt, systemPrompt, images = []) => {
  if (images.length > 0) {
    try {
      return await generateAIJSONWithImages(prompt + SCRIPT_IMAGES_NOTE, systemPrompt, images)
    } catch (err) {
      console.error('[Marking] Marking with scanned pages failed, using transcription only:', err.message)
    }
  }
  return generateAIJSON(prompt, systemPrompt)
}
import { getCurriculumScope, formatScopeNote } from './curriculumGrounding.utils.js'

// ── WASSCE grade calculator ─────────────────────────────────────
// Takes a raw score and total available marks.
// Returns the official WASSCE grade and label.
export const calculateWASSCEGrade = (score, totalMarks) => {
  if (!totalMarks) return { grade: 'N/A', label: 'No marks', percent: 0 }

  const percent = Math.round((score / totalMarks) * 100)

  if (percent >= 75) return { grade: 'A1', label: 'Excellent',  percent }
  if (percent >= 70) return { grade: 'B2', label: 'Very Good',  percent }
  if (percent >= 65) return { grade: 'B3', label: 'Good',       percent }
  if (percent >= 60) return { grade: 'C4', label: 'Credit',     percent }
  if (percent >= 55) return { grade: 'C5', label: 'Credit',     percent }
  if (percent >= 50) return { grade: 'C6', label: 'Credit',     percent }
  if (percent >= 45) return { grade: 'D7', label: 'Pass',       percent }
  if (percent >= 40) return { grade: 'E8', label: 'Pass',       percent }
  return                     { grade: 'F9', label: 'Fail',       percent }
}

// ── BECE grade calculator ───────────────────────────────────────
// Distinct scale from WASSCE — a plain 1 (best) to 9 (worst) numeric
// grade with its own bands and remarks (WAEC BECE grading, 2026).
// Grade is returned as a string ('1'..'9') to match the existing
// `waecGrade: String` schema field used by both exam types.
export const calculateBECEGrade = (score, totalMarks) => {
  if (!totalMarks) return { grade: 'N/A', label: 'No marks', percent: 0 }

  const percent = Math.round((score / totalMarks) * 100)

  if (percent >= 90) return { grade: '1', label: 'Highest',      percent }
  if (percent >= 80) return { grade: '2', label: 'Higher',       percent }
  if (percent >= 70) return { grade: '3', label: 'High',         percent }
  if (percent >= 60) return { grade: '4', label: 'High Average', percent }
  if (percent >= 55) return { grade: '5', label: 'Average',      percent }
  if (percent >= 50) return { grade: '6', label: 'Low Average',  percent }
  if (percent >= 40) return { grade: '7', label: 'Low',          percent }
  if (percent >= 35) return { grade: '8', label: 'Lower',        percent }
  return                     { grade: '9', label: 'Lowest',       percent }
}

// ── Grade dispatcher ─────────────────────────────────────────────
// Picks the right scale for the student's exam type. Defaults to
// WASSCE for anything other than 'BECE', matching the same
// default-to-WASSCE convention used by resolveExamType().
export const calculateGrade = (score, totalMarks, examType) =>
  examType === 'BECE'
    ? calculateBECEGrade(score, totalMarks)
    : calculateWASSCEGrade(score, totalMarks)

// ── MCQ marker ────────────────────────────────────────────────
// Simple string comparison — no AI needed.
// Returns marking result for a single MCQ answer.
export const markMCQ = (studentAnswer, correctAnswer, marks = 1) => {
  const isCorrect = studentAnswer?.trim().toUpperCase() ===
                    correctAnswer?.trim().toUpperCase()
  return {
    isCorrect,
    marksAwarded:   isCorrect ? marks : 0,
    marksAvailable: marks,
  }
}

// ── AI essay marker ───────────────────────────────────────────
// Marks any non-MCQ answer — branches internally on whether the
// question has multi-part sub-questions (question.parts.length > 0,
// what used to be a separate 'Structured' type — marked part-by-part
// against its own marking guide) or is a single free-response essay
// (marked against the four fixed WAEC essay criteria). Both paths
// return the same result shape, so callers never need to know which
// one ran.
// `images` ([{ data, mimeType }]) are the student's scanned pages, if
// the answer was photographed — see SCRIPT_IMAGES_NOTE.
export const markEssay = async (question, studentAnswer, subject, images = []) => {
  if (question.parts?.length > 0) {
    return markMultiPart(question, studentAnswer, subject, images)
  }
  return markFreeResponseEssay(question, studentAnswer, subject, images)
}

// ── Multi-part marker (lettered sub-questions, own marking guide) ─
const markMultiPart = async (question, studentAnswer, subject, images = []) => {
  const systemPrompt = `You are an experienced WAEC ${subject} examiner.
Mark student answers fairly and consistently against the marking guide.
Award partial marks where the student shows partial understanding.
Be constructive — explain what was missing, not just what was wrong.
Respond with valid JSON only. No markdown. No preamble.`

  const prompt = `
QUESTION:
${question.questionText}

MARKING GUIDE (model answer):
${question.modelAnswer || 'No model answer provided — use your expertise.'}

PARTS AND ALLOCATIONS:
${question.parts?.map(p => `Part (${p.part}) — ${p.marks} marks: ${p.text}`).join('\n') || 'No parts defined'}

STUDENT'S ANSWER:
${studentAnswer}

Mark this answer. For each part award marks based on:
- Accuracy of content
- Correct use of terminology
- Clarity of explanation
- Whether key marking points are addressed

Return this exact JSON structure:
{
  "parts": [
    {
      "part": "a",
      "marksAwarded": 2,
      "marksAvailable": 3,
      "feedback": "Good explanation of X but missed Y which is worth 1 mark."
    }
  ],
  "totalMarksAwarded": 5,
  "totalMarksAvailable": 10,
  "overallFeedback": "Examiner comment on the overall response."
}` + formatScopeNote(getCurriculumScope(subject, question.topic))

  try {
    const result = await markWithAI(prompt, systemPrompt, images)
    return {
      isCorrect:      result.totalMarksAwarded >= result.totalMarksAvailable * 0.5,
      marksAwarded:   result.totalMarksAwarded   || 0,
      marksAvailable: result.totalMarksAvailable || question.marks,
      partResults:    result.parts               || [],
      overallFeedback: result.overallFeedback    || '',
    }
  } catch (err) {
    console.error('[Marking] Multi-part marking failed:', err.message)
    // Graceful fallback — don't crash the session
    return {
      isCorrect:      false,
      marksAwarded:   0,
      marksAvailable: question.marks,
      partResults:    [],
      overallFeedback: 'Marking unavailable — please review manually.',
    }
  }
}

// ── Free-response essay marker (four fixed WAEC criteria) ─────────
const markFreeResponseEssay = async (question, studentAnswer, subject, images = []) => {
  const systemPrompt = `You are an experienced WAEC ${subject} examiner marking essay responses.
Use the official WAEC essay assessment criteria.
Be fair, constructive, and specific in your feedback.
Respond with valid JSON only. No markdown. No preamble.`

  const prompt = `
ESSAY QUESTION:
${question.questionText}

TOTAL MARKS AVAILABLE: ${question.marks || 20}

STUDENT'S ESSAY:
${studentAnswer}

Mark this essay using these four WAEC criteria.
Allocate marks proportionally based on the total available (${question.marks || 20} marks):
1. Content & relevance (40% of marks) — did they answer the question?
2. Organisation (20% of marks) — is it structured logically?
3. Language & expression (20% of marks) — is English accurate?
4. Depth & analysis (20% of marks) — does it show understanding?

Return this exact JSON structure:
{
  "criteria": [
    { "name": "Content & relevance",   "marksAwarded": 7, "marksAvailable": 8, "feedback": "..." },
    { "name": "Organisation",          "marksAwarded": 3, "marksAvailable": 4, "feedback": "..." },
    { "name": "Language & expression", "marksAwarded": 3, "marksAvailable": 4, "feedback": "..." },
    { "name": "Depth & analysis",      "marksAwarded": 3, "marksAvailable": 4, "feedback": "..." }
  ],
  "totalMarksAwarded": 16,
  "totalMarksAvailable": 20,
  "examinerComment": "Overall examiner comment on the quality of the response.",
  "passFailIndicator": "Pass"
}` + formatScopeNote(getCurriculumScope(subject, question.topic))

  try {
    const result = await markWithAI(prompt, systemPrompt, images)
    return {
      isCorrect:        result.totalMarksAwarded >= result.totalMarksAvailable * 0.5,
      marksAwarded:     result.totalMarksAwarded   || 0,
      marksAvailable:   result.totalMarksAvailable || question.marks,
      partResults:      result.criteria            || [],
      overallFeedback:  result.examinerComment     || '',
      passFailIndicator: result.passFailIndicator  || 'N/A',
    }
  } catch (err) {
    console.error('[Marking] Essay marking failed:', err.message)
    return {
      isCorrect:       false,
      marksAwarded:    0,
      marksAvailable:  question.marks,
      partResults:     [],
      overallFeedback: 'Marking unavailable — please review manually.',
    }
  }
}

// ── AI explanation generator ───────────────────────────────────
// Called when student taps "Explain this" after answering.
// Returns a structured explanation object.
export const generateExplanation = async (question, studentAnswer, isCorrect, subject) => {
  const systemPrompt = `You are an expert ${subject} tutor helping a WASSCE/BECE student understand 
examination questions. Your explanations are clear, encouraging, and exam-focused.
You always reference WAEC examiner expectations.
Respond with valid JSON only. No markdown. No preamble.`

  const prompt = `
QUESTION: ${question.questionText}

${question.type === 'MCQ' ? `
OPTIONS:
A. ${question.options?.[0] || ''}
B. ${question.options?.[1] || ''}
C. ${question.options?.[2] || ''}
D. ${question.options?.[3] || ''}
CORRECT ANSWER: ${question.correctOption}
STUDENT'S ANSWER: ${studentAnswer}
STUDENT WAS: ${isCorrect ? 'CORRECT' : 'INCORRECT'}
` : `
MODEL ANSWER: ${question.modelAnswer || ''}
STUDENT'S ANSWER: ${studentAnswer}
`}

Generate a helpful explanation for this student.

Return this exact JSON:
{
  "conceptExplained": "What concept or skill is this question testing?",
  "whyCorrectIsRight": "Clear explanation of why the correct answer is right.",
  "whyStudentWasWrong": "If incorrect: why the student's answer was wrong. If correct: what they did well.",
  "commonMistakes": "What do most candidates get wrong on this type of question?",
  "studyTip": "One specific study tip for this topic.",
  "keyTerms": ["term1", "term2"]
}` + formatScopeNote(getCurriculumScope(subject, question.topic))

  try {
    return await generateAIJSON(prompt, systemPrompt)
  } catch (err) {
    console.error('[Marking] Explanation generation failed:', err.message)
    return {
      conceptExplained:  'Explanation unavailable.',
      whyCorrectIsRight: question.type === 'MCQ' ? `The correct answer is ${question.correctOption}.` : 'See model answer.',
      whyStudentWasWrong: '',
      commonMistakes:    '',
      studyTip:          `Review your ${question.topic} notes and practice similar questions.`,
      keyTerms:          [],
    }
  }
}

// ── Marking checklist for Essay questions ───────────────────────
// Called from mock exam review when a student taps "Explain" on a
// non-MCQ question. Unlike generateExplanation's prose, this breaks
// the marking guide into concrete points and says whether the
// student's actual answer achieved each one — a mark scheme, not
// a study article.
export const generateMarkingChecklist = async (question, subject) => {
  const systemPrompt = `You are an experienced WAEC ${subject} examiner explaining a marked answer to a student.
Be concrete and specific — reference exactly what the student wrote, not generic advice.
Respond with valid JSON only. No markdown. No preamble.`

  const prompt = `
QUESTION: ${question.questionText}

${question.parts?.length ? `PARTS:\n${question.parts.map(p => `(${p.part}) [${p.marks}m] ${p.text}`).join('\n')}` : ''}

MARKING GUIDE (model answer): ${question.modelAnswer || 'Not provided'}

STUDENT'S ANSWER:
${question.studentAnswer || '(no answer given)'}

MARKS AWARDED: ${question.marksAwarded ?? 0} / ${question.marks}
EXAMINER FEEDBACK ALREADY GIVEN: ${question.aiFeedback || 'None'}

Break the marking guide down into the concrete, specific points a WAEC examiner
would award marks for on this question. For each point, decide whether the
student's actual answer above achieved it, and note briefly how/why.

Return this exact JSON:
{
  "keyMarkingPoints": [
    { "point": "Specific mark-earning point derived from the marking guide", "achieved": true, "note": "Where/how the student did or didn't cover this" }
  ],
  "whatWasMissing": ["Concrete thing the student should add to earn full marks"],
  "studyTip": "One specific study tip for this topic."
}` + formatScopeNote(getCurriculumScope(subject, question.topic))

  try {
    return await generateAIJSON(prompt, systemPrompt)
  } catch (err) {
    console.error('[Marking] Checklist generation failed:', err.message)
    return {
      keyMarkingPoints: [],
      whatWasMissing:   [],
      studyTip:         `Review your ${question.topic} notes and compare your answer to the marking scheme above.`,
    }
  }
}

// ── Spaced repetition (Leitner system) ──────────────────────────
// Review interval in days per box — box 0 (just missed) reviews
// tomorrow; box 5 (well consolidated) reviews in a month. Correct
// answers advance a box and push the review date further out; a
// wrong answer resets straight back to box 0 regardless of how far
// it had climbed, so a genuine gap doesn't quietly resurface far away
// in the future because it happened to have a good streak once.
const LEITNER_INTERVAL_DAYS = [1, 1, 3, 7, 14, 30]

const daysFromNow = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000)

// ── Score → star rating ──────────────────────────────────────────
// Mirrors the tier boundaries client/src/components/MasteryBadge.jsx
// already uses (getMasteryConfig) — stars and the existing mastery
// tier language must never disagree.
export const scoreToStars = (score) => {
  if (score === 0)  return 0
  if (score < 30)   return 1
  if (score < 55)   return 2
  if (score < 75)   return 3
  if (score < 90)   return 4
  return 5
}

// The "Competent" boundary — the bar a session must clear on the
// Session Path before the next one is presented as unlocked.
export const UNLOCK_THRESHOLD = 55

// ── Mastery score updater ──────────────────────────────────────
// Pure function — takes current mastery state and answer result,
// returns new score, difficulty, and spaced-repetition schedule.
// No database calls.
export const computeMasteryUpdate = (current, isCorrect, marksAwarded, marksAvailable) => {
  const partialCredit = marksAvailable > 0 ? marksAwarded / marksAvailable : 0

  let newScore       = current.score
  let consecutiveCorrect   = current.consecutiveCorrect   || 0
  let consecutiveIncorrect = current.consecutiveIncorrect || 0
  let newDifficulty  = current.difficulty || 2
  let leitnerBox     = current.leitnerBox || 0

  if (isCorrect || partialCredit >= 0.7) {
    // Good answer — increase mastery
    const gain = isCorrect ? 5 : 3
    newScore = Math.min(100, newScore + gain)
    consecutiveCorrect   += 1
    consecutiveIncorrect  = 0

    // Level up after 3 consecutive correct answers
    if (consecutiveCorrect >= 3 && newDifficulty < 5) {
      newDifficulty      += 1
      consecutiveCorrect  = 0
    }

    leitnerBox = Math.min(5, leitnerBox + 1)
  } else {
    // Wrong answer — decrease mastery slightly
    const loss = partialCredit < 0.3 ? 3 : 1
    newScore = Math.max(0, newScore - loss)
    consecutiveIncorrect += 1
    consecutiveCorrect    = 0

    // Level down after 2 consecutive wrong answers
    if (consecutiveIncorrect >= 2 && newDifficulty > 1) {
      newDifficulty       -= 1
      consecutiveIncorrect = 0
    }

    leitnerBox = 0
  }

  return {
    score:                newScore,
    difficulty:           newDifficulty,
    consecutiveCorrect,
    consecutiveIncorrect,
    leitnerBox,
    nextReviewDate:       daysFromNow(LEITNER_INTERVAL_DAYS[leitnerBox]),
  }
}