import Question from '../models/Question.model.js'
import MasteryProfile from '../models/MasteryProfile.model.js'
import { generateAIJSON, generateAIJSONWithImages, generateAIResponse } from './aiService.js'
import { getCurriculumScope, formatScopeNote } from './curriculumGrounding.utils.js'

// ── WAEC paper structure constants ─────────────────────────────
// Generic default — applies to every subject/exam-type combo that
// doesn't have a real structure of its own in SUBJECT_PAPER_STRUCTURES.
//
// `type` is only ever 'MCQ' or 'Essay' now — there's no separate
// "Structured" question type any more. What used to be signalled by
// `type: 'Structured'` (a multi-part, lettered-sub-question answer
// with its own marking scheme, vs. a single free-response essay) is
// now signalled by the `multiPart` flag on each section below, which
// controls what fillWithAI asks Gemini to generate, and ultimately
// shows up as a populated `parts` array on the question — the same
// array PartAnswerEditor.jsx (client) already renders from directly,
// regardless of the `type` string.
export const PAPER_STRUCTURE = {
  sectionA: { type: 'MCQ',   count: 40, marksEach: 1,  totalMarks: 40 },
  sectionB: { type: 'Essay', count: 4,  marksEach: 10, totalMarks: 40, multiPart: true  },
  sectionC: { type: 'Essay', count: 2,  marksEach: 20, totalMarks: 40, multiPart: false },
  sectionCAnswerCount: 1,
  // Note: Section C — student answers ONE essay (20 marks)
  // so availableMarks = 100 total (40 + 40 + 20)
}

// ── Real per-subject paper structures ──────────────────────────
// BECE Computing's actual paper: Paper 1 (Objectives, 40 MCQ) already
// matches the generic Section A. Paper 2 (Essay, 60 marks) does not:
// Section A is Question 1, compulsory, 24 marks (usually practical/
// diagram-based); Section B offers 4 questions, student answers any
// 3 at 12 marks each = 36. Real transcribed questions for this
// subject already carry the correct `marks` value (24 / 12) even
// though their type/section tagging is inconsistent, so this section
// fetches by marks rather than the generic type+section filter.
// BECE Mathematics' actual paper: Section A (Objectives, 40 MCQ, 1 mark
// each = 40) already matches the generic Section A. There is no
// separate compulsory theory section like Computing's — WAEC's own
// "Section B" (6 questions offered, each with (a)/(b)/(c)-style parts,
// student answers any 4 at 15 marks each = 60) maps entirely onto this
// app's `sectionC` bucket, since that's the one built to handle
// "answer N of M offered" — `sectionB` is deliberately left empty
// (count 0) for this subject. `multiPart: true` on that bucket matters:
// these are genuinely multi-part structured answers, and it's what
// tells fillWithAI to generate dotted-part questions when the bank is
// thin, not free-form essay filler.
export const SUBJECT_PAPER_STRUCTURES = {
  'BECE:Computing': {
    sectionA: { type: 'MCQ',   count: 40, marksEach: 1,  totalMarks: 40, fetchBy: 'typeSection' },
    sectionB: { type: 'Essay', count: 1,  marksEach: 24, totalMarks: 24, fetchBy: 'marks', multiPart: true  },
    sectionC: { type: 'Essay', count: 4,  marksEach: 12, totalMarks: 36, fetchBy: 'marks', multiPart: false },
    sectionCAnswerCount: 3,
  },
  'BECE:Mathematics': {
    sectionA: { type: 'MCQ',   count: 40, marksEach: 1,  totalMarks: 40, fetchBy: 'typeSection' },
    sectionB: { type: 'Essay', count: 0,  marksEach: 0,  totalMarks: 0,  multiPart: true },
    sectionC: { type: 'Essay', count: 6,  marksEach: 15, totalMarks: 60, fetchBy: 'marks', multiPart: true },
    sectionCAnswerCount: 4,
  },
  // BECE Science's actual paper: Objectives (40 MCQ) matches the generic
  // Section A. Theory Paper has its own "Section A" — Question 1,
  // compulsory, 40 marks, often diagram-based — mapped onto this app's
  // `sectionB` bucket (mirrors Computing's one-compulsory-question
  // precedent). Theory Paper's own "Section B" offers 4 questions,
  // student answers any 3 at 20 marks each = 60, mapped onto `sectionC`.
  // Raw total available is 40+40+60=140, not the usual 100 — markFullPaper
  // scales the final total/percent down to a 100 basis for this reason.
  'BECE:Science': {
    sectionA: { type: 'MCQ',   count: 40, marksEach: 1,  totalMarks: 40, fetchBy: 'typeSection' },
    sectionB: { type: 'Essay', count: 1,  marksEach: 40, totalMarks: 40, fetchBy: 'marks', multiPart: true },
    sectionC: { type: 'Essay', count: 4,  marksEach: 20, totalMarks: 60, fetchBy: 'marks', multiPart: true },
    sectionCAnswerCount: 3,
  },
  // BECE English Language's actual paper: Paper 1 (Objectives, 40 MCQ)
  // matches the generic Section A. Paper 2 has THREE real parts — Essay
  // Writing (offer 3, answer 1, 30 marks), Comprehension (compulsory, one
  // passage, 20 marks), and Literature (compulsory, 10 marks) — but this
  // app only has two non-MCQ buckets. Comprehension + Literature are
  // merged into one compulsory `sectionB` item (both are compulsory
  // anyway); `promptHint` tells the AI generator how to split it into a
  // passage + comprehension parts + "[Literature]"-prefixed parts, since
  // the generic multi-part prompt has no way to know that on its own.
  // Essay Writing maps onto `sectionC`'s existing "offer M, answer N"
  // mechanic exactly as-is.
  'BECE:English Language': {
    sectionA: { type: 'MCQ', count: 40, marksEach: 1, totalMarks: 40, fetchBy: 'typeSection' },
    sectionB: {
      type: 'Essay', count: 1, marksEach: 30, totalMarks: 30, fetchBy: 'marksTypeSection', multiPart: true,
      promptHint: `This compulsory question combines two parts. Write a short reading passage ` +
        `(150-250 words, Ghanaian/West African context) as the questionText. Then use "parts" for: ` +
        `3-4 comprehension sub-questions about the passage (lettered a, b, c... testing understanding, ` +
        `vocabulary and inference) worth a combined 20 marks, followed by 2 literature sub-questions ` +
        `(continuing the same letter sequence) worth a combined 10 marks, based on a well-known West ` +
        `African prescribed text (e.g. a Ghanaian novel, play or poem) — prefix each literature part's ` +
        `"text" with "[Literature]" so it reads as clearly distinct from the comprehension parts.`,
    },
    // sectionB and sectionC coincidentally share both marksEach: 30
    // (Comprehension+Literature = 20+10, Essay = 30) AND type ('Essay' for
    // both, now that Structured no longer exists as a separate type) —
    // `fetchBy: 'marksTypeSection'` disambiguates them by `section` too.
    sectionC: { type: 'Essay', count: 3, marksEach: 30, totalMarks: 30, fetchBy: 'marksTypeSection', multiPart: false },
    sectionCAnswerCount: 1,
  },
  // BECE Social Studies' actual paper: Paper 1 (Objectives, 40 MCQ)
  // matches the generic Section A. Paper 2 (Essay) has three real
  // sections — A: The Environment (compulsory), B: Law, Order and
  // Nation Building (2 offered), C: Socio-Economic Development (2
  // offered), student answers the compulsory one plus one each from
  // B/C — but this app only has two non-MCQ buckets. The compulsory
  // Environment question maps onto `sectionB`; Law/Order + Socio-
  // Economic are merged into one "offer 4, answer 2" `sectionC` pool
  // (both are 20 marks each, same as the compulsory one, so a plain
  // marks-only or marks+type filter can't tell sectionB from sectionC —
  // `fetchBy: 'marksTypeSection'` disambiguates by `section` too). The
  // exam UI shows a soft "one from each theme" instruction since the
  // app can't enforce picking one from each real sub-theme.
  'BECE:Social Studies': {
    sectionA: { type: 'MCQ', count: 40, marksEach: 1, totalMarks: 40, fetchBy: 'typeSection' },
    sectionB: {
      type: 'Essay', count: 1, marksEach: 20, totalMarks: 20, fetchBy: 'marksTypeSection', multiPart: true,
      promptHint: `This compulsory question is on The Environment (natural resources, environmental ` +
        `issues, land degradation, conservation, sustainable development in Ghana/West Africa). Write a ` +
        `multi-part structured question with lettered parts (a), (b), (c)... covering explanation, causes/` +
        `effects, and solutions/recommendations, worth a combined 20 marks. Set "topic" to "The Environment".`,
    },
    sectionC: {
      type: 'Essay', count: 4, marksEach: 20, totalMarks: 40, fetchBy: 'marksTypeSection', multiPart: true,
      promptHint: `Generate exactly 2 questions on "Law, Order and Nation Building" (rule of law, government, ` +
        `national institutions, human rights, democracy) and 2 questions on "Socio-Economic Development" ` +
        `(population, employment, entrepreneurship, national development, social issues in Ghana) — set each ` +
        `question's "topic" field to its exact theme name so the two are clearly distinguishable. Each is a ` +
        `multi-part structured question with lettered parts (a), (b), (c)..., worth 20 marks.`,
    },
    sectionCAnswerCount: 2,
  },
  // BECE Religious & Moral Education's actual paper (WAEC "Structure and
  // Scheme of the Examination"): Paper 1 (Objective, 40 MCQ) matches the
  // generic Section A. Paper 2 (Essay) has two real sections — A:
  // compulsory (20 marks), B: 4 offered, answer 2 (20 marks each) —
  // mapping cleanly onto this app's sectionB (compulsory) / sectionC
  // (offer 4, answer 2) with no merge needed. Both end up at the same
  // marksEach (20) AND multiPart (true for both, matching WAEC's real
  // scenario+lettered-parts style for both) — `fetchBy: 'marksTypeSection'`
  // disambiguates by `section` too, and also excludes old free-form
  // Essay-tagged content (pre-existing bank items with no lettered parts)
  // from being pulled into the new sectionC.
  'BECE:Religious & Moral Education': {
    sectionA: { type: 'MCQ', count: 40, marksEach: 1, totalMarks: 40, fetchBy: 'typeSection' },
    sectionB: {
      type: 'Essay', count: 1, marksEach: 20, totalMarks: 20, fetchBy: 'marksTypeSection', multiPart: true,
      promptHint: `This compulsory question presents a short real-life Ghanaian scenario, then asks ` +
        `4 lettered sub-questions (a, b, c, d) of increasing depth (identify/state → explain/discuss) on a ` +
        `Religious and Moral Education topic (e.g. moral values, family, religion, environment, authority), ` +
        `worth a combined 20 marks.`,
    },
    sectionC: {
      type: 'Essay', count: 4, marksEach: 20, totalMarks: 40, fetchBy: 'marksTypeSection', multiPart: true,
      promptHint: `Each question presents a short real-life Ghanaian scenario (or none, for a direct multi-part ` +
        `prompt), then asks 2-4 lettered sub-questions (a, b, c, d...) worth a combined 20 marks, covering a ` +
        `mix of Religious and Moral Education topics (e.g. Christianity, Islam, African Traditional Religion, ` +
        `marriage and family, work and leisure, social issues).`,
    },
    sectionCAnswerCount: 2,
  },
  // BECE Career Technology's actual paper: Paper 1 (Objective, 40 MCQ)
  // matches the generic Section A. Paper 2 has two real parts, each
  // "1 forced-compulsory + choose 1 of 2 alternates" (Part A: Q1
  // compulsory; Part B: Q4 compulsory), 15 marks each. Split each Part
  // in two and recombine by role: the two compulsory "test of practical"
  // questions go into sectionB (uses ExamSectionB.jsx's existing "answer
  // ALL N" rendering), and the 4 remaining alternates (2 from each Part)
  // are merged into sectionC's "offer 4, answer 2" pool — same tradeoff
  // already accepted for Social Studies (no distinguishing mechanism for
  // "1 from each Part" since these alternates don't share topic names).
  // Both buckets land on marksEach: 15 AND multiPart: true, so
  // `fetchBy: 'marksTypeSection'` (built for Social Studies) disambiguates
  // them and excludes old generic-structure bank content (10/20 marks).
  'BECE:Career Technology': {
    sectionA: { type: 'MCQ', count: 40, marksEach: 1, totalMarks: 40, fetchBy: 'typeSection' },
    sectionB: {
      type: 'Essay', count: 2, marksEach: 15, totalMarks: 30, fetchBy: 'marksTypeSection', multiPart: true,
      promptHint: `This is a "test of practical" question — a hands-on task description (e.g. a recipe/` +
        `procedure to describe step by step, a technical drawing/projection to construct, a joint or ` +
        `artefact to illustrate stage by stage) from the Career Technology syllabus (Food and Nutrition, ` +
        `Home Management, Woodwork, Metalwork, Technical Drawing, Basic Electronics, etc.), worth 15 marks. ` +
        `May be a single instruction or have a few lettered parts (a, b, c...).`,
    },
    sectionC: {
      type: 'Essay', count: 4, marksEach: 15, totalMarks: 30, fetchBy: 'marksTypeSection', multiPart: true,
      promptHint: `Each question is a Career Technology task (hygiene/safety, design, construction, ` +
        `maintenance, or similar practical topics), worth 15 marks, covering a mix of distinct syllabus ` +
        `areas (Food and Nutrition, Home Management, Woodwork, Metalwork, Technical Drawing, Basic ` +
        `Electronics). May be a single instruction or have a few lettered parts (a, b, c...).`,
    },
    sectionCAnswerCount: 2,
  },
  // BECE Creative Arts and Design's actual paper: Paper 1 (Objective, 40
  // MCQ) matches the generic Section A. Paper 2 has 3 real sections —
  // Visual Art (Q1 Design compulsory + 1 of 2 alternates), Music (1 of
  // 2), Dance and Drama (1 of 2), answer 4 total at 15 marks each. Same
  // "1 compulsory + 3 separate choice pools" shape as Career Technology,
  // same accepted tradeoff: sectionB = the compulsory Design question;
  // sectionC = all 6 remaining alternates merged into one "offer 6,
  // answer 3" pool (real "1 from each pool" rule not enforced). Also:
  // real Design/Music questions are literal drawing/notation tasks
  // (create a doodle pattern, construct a scale on a staff) that a
  // text-only platform can't grade — confirmed with the user to reword
  // these as describe/explain tasks instead, same spirit as Career
  // Technology's practical questions (describe-the-process, not
  // perform-the-craft). Both buckets land on marksEach: 15, so
  // `fetchBy: 'marksTypeSection'` disambiguates them.
  'BECE:Creative Arts and Design': {
    sectionA: { type: 'MCQ', count: 40, marksEach: 1, totalMarks: 40, fetchBy: 'typeSection' },
    sectionB: {
      type: 'Essay', count: 1, marksEach: 15, totalMarks: 15, fetchBy: 'marksTypeSection', multiPart: true,
      promptHint: `This is the compulsory Design question — since this is a text-only platform, reword ` +
        `it as a describe/explain task rather than a literal drawing task (e.g. instead of "create a line ` +
        `doodle pattern", ask the student to describe the elements and principles of design they would use, ` +
        `explain the steps of a design technique, or analyse a design scenario), worth 15 marks. May have a ` +
        `few lettered parts (a, b, c...).`,
    },
    sectionC: {
      type: 'Essay', count: 6, marksEach: 15, totalMarks: 45, fetchBy: 'marksTypeSection', multiPart: true,
      promptHint: `Generate 2 Visual Art questions (on strands other than Design, e.g. Picture Making, ` +
        `Textiles, Sculpture, Ceramics, Graphic Design — describe/explain/identify tasks, NOT literal ` +
        `drawing tasks), 2 Music questions (music theory, notation concepts explained in words, Ghanaian ` +
        `musicians/genres, or general appreciation — avoid tasks requiring drawing notation on a staff), ` +
        `and 2 Dance and Drama questions (describe/explain/identify tasks on elements, roles, or importance ` +
        `of dance and drama). Each worth 15 marks, set each question's "topic" field to indicate which of ` +
        `the 3 areas it belongs to.`,
    },
    sectionCAnswerCount: 3,
  },
  // BECE French's actual paper (WAEC "Structure and Scheme of the
  // Examination"): Paper 1 (Objective) is 40 MCQ across Listening
  // Comprehension, Written Comprehension, and Vocabulary — but Listening
  // is explicitly marked "(Put on hold)" in the WAEC document itself
  // (needs audio logistics WAEC hasn't rolled out), and this platform
  // has no audio support anyway, so sectionA is generated as text-only
  // comprehension/vocabulary/grammar. Officially, when the Oral paper is
  // on hold, WAEC scales Paper 1's 40 marks ×1.5 to 60 — the first
  // subject needing a real per-section `scalingFactor` (see
  // markFullPaper above). Paper 2 (Written Expression) has 2 COMPULSORY
  // questions, no choice at all — maps onto sectionB's "answer ALL N"
  // mode; sectionC is entirely unused (count: 0), same as BECE
  // Mathematics' unused sectionB.
  'BECE:French': {
    sectionA: {
      type: 'MCQ', count: 40, marksEach: 1, totalMarks: 40, fetchBy: 'typeSection', scalingFactor: 1.5,
      promptHint: `Generate text-based French comprehension, vocabulary, and grammar/usage questions only — ` +
        `Listening Comprehension is not tested on this platform since it requires audio playback, which ` +
        `isn't supported here.`,
    },
    sectionB: {
      type: 'Essay', count: 2, marksEach: 20, totalMarks: 40, fetchBy: 'marksTypeSection', multiPart: true,
      promptHint: `Generate one task-based question: a short scenario in French followed by several lettered ` +
        `sub-tasks (e.g. filling out a form, giving short answers, giving information about a person/place/` +
        `event, giving advice, giving directions using a described map, describing a profession), worth a ` +
        `combined 20 marks, topic "Task-Based Writing". And one single-prompt essay/composition question in ` +
        `French with no lettered parts, worth 20 marks, topic "Essay".`,
    },
    sectionC: { type: 'Essay', count: 0, marksEach: 0, totalMarks: 0, multiPart: false },
    sectionCAnswerCount: 0,
  },
}

// BECE Ghanaian Language's actual paper (WAEC "Structure and Scheme of the
// Examination", shared verbatim across every language variant): Paper 1
// (Objective, 40 MCQ) matches the generic Section A. Paper 2 has 4 real
// parts — Composition (choose 1 of ~4 topics, 30 marks), Comprehension
// (compulsory, 10 marks), Translation (compulsory, 10 marks), Language
// and Usage (compulsory, 10 marks). Unlike English/Social Studies/RME,
// this maps onto this app's sectionB/sectionC with ZERO friction: sectionB
// already means "N compulsory questions, answer all" (see
// ExamSectionB.jsx, which already renders "Answer ALL N questions" with no
// selection UI) — a perfect fit for bundling Comprehension+Translation+
// Language&Usage as 3 compulsory 10-mark items. sectionC's existing
// "offer M, answer N" mechanic fits Composition's "choose 1 topic" exactly
// (same mechanic already used for Math/English's essay-writing choice).
const ghanaianLanguageStructure = {
  sectionA: { type: 'MCQ', count: 40, marksEach: 1, totalMarks: 40, fetchBy: 'typeSection' },
  sectionB: {
    type: 'Essay', count: 3, marksEach: 10, totalMarks: 30, fetchBy: 'marks', multiPart: true,
    promptHint: `Generate exactly one Comprehension question (a short passage written IN the ` +
      `language being examined, followed by 8-10 lettered sub-questions (a, b, c...) about it, each ` +
      `worth 1 mark, testing understanding), one Translation question (10 lettered parts (a-j), each ` +
      `asking the student to translate one short English sentence into the language, 1 mark each — use ` +
      `these exact 10 sentences: "The students were rewarded for their performance.", "I saw a snake in ` +
      `the bush on my way to school.", "It rained heavily this morning.", "The teacher is very thirsty.", ` +
      `"The harmattan is very severe this year.", "Who came here yesterday?", "You must be careful on ` +
      `the road.", "Kofi ate all the food on the table.", "The big black cat jumped over the wall.", ` +
      `"Why do people cheat others so much in this country?"), and one Language and Usage question ` +
      `(8-10 lettered sub-questions on grammar, sentence construction, idioms/proverbs, or word usage in ` +
      `the language). Each of these 3 questions is worth a combined 10 marks across its own sub-parts, ` +
      `and set each question's "topic" field to "Comprehension", "Translation", or "Language and Usage" ` +
      `respectively so they're distinguishable.`,
  },
  sectionC: {
    type: 'Essay', count: 4, marksEach: 30, totalMarks: 30, fetchBy: 'marks', multiPart: false,
    promptHint: `Composition topics in the style of: describing a personal experience, writing a formal ` +
      `or informal letter, narrating an event, or giving an account of a place or custom — written ` +
      `entirely IN the language being examined, roughly 150 words expected in the answer.`,
  },
  sectionCAnswerCount: 1,
}

for (const lang of ['Asante Twi', 'Akuapim Twi', 'Ga', 'Ewe']) {
  SUBJECT_PAPER_STRUCTURES[`BECE:${lang}`] = ghanaianLanguageStructure
}

export const getPaperStructure = (examType, subject) =>
  SUBJECT_PAPER_STRUCTURES[`${examType}:${subject}`] || PAPER_STRUCTURE

// ── Main paper generator ───────────────────────────────────────
// Assembles a full WAEC-standard paper from the question bank.
// Uses prediction data and mastery profile to weight selection —
// predicted hot topics + low mastery topics appear more frequently.
export const generatePaper = async (studentId, subject, examType) => {
  const structure = getPaperStructure(examType, subject)

  // ── 1. Get student mastery profiles ──────────────────────────
  const masteryProfiles = await MasteryProfile.find({
    studentId,
    subject,
  }).lean()

  const masteryMap = masteryProfiles.reduce((map, m) => {
    map[m.topic] = m.score
    return map
  }, {})

  // ── 2. Build weighting for topic selection ────────────────────
  // Topics with low mastery get a higher chance of appearing
  // This ensures the mock exam challenges the student appropriately
  const getTopicWeight = (topic) => {
    const score = masteryMap[topic] ?? 50  // unknown topics get medium weight
    // Invert score: low mastery = high weight
    return Math.max(10, 100 - score)
  }

  // ── 3. Fetch questions for each section ───────────────────────
  const [sectionAQuestions, sectionBQuestions, sectionCQuestions] =
    await Promise.all([
      fetchSectionQuestions(subject, examType, structure.sectionA, 'A', 60, masteryMap),
      fetchSectionQuestions(subject, examType, structure.sectionB, 'B', Math.max(8, structure.sectionB.count * 2), masteryMap),
      fetchSectionQuestions(subject, examType, structure.sectionC, 'C', Math.max(4, structure.sectionC.count * 2), masteryMap),
    ])

  // ── 4. Select questions with mastery weighting ────────────────
  const selectedA = weightedSelect(sectionAQuestions, structure.sectionA.count, getTopicWeight)
  const selectedB = weightedSelect(sectionBQuestions, structure.sectionB.count, getTopicWeight)
  const selectedC = weightedSelect(sectionCQuestions, structure.sectionC.count, getTopicWeight)

  // ── 5. If bank doesn't have enough, generate with AI ──────────
  const finalA = await fillWithAI(selectedA, structure.sectionA.count, subject, examType, structure.sectionA.type, 'A', structure.sectionA.marksEach, structure.sectionA.promptHint, structure.sectionA.multiPart)
  const finalB = await fillWithAI(selectedB, structure.sectionB.count, subject, examType, structure.sectionB.type, 'B', structure.sectionB.marksEach, structure.sectionB.promptHint, structure.sectionB.multiPart)
  const finalC = await fillWithAI(selectedC, structure.sectionC.count, subject, examType, structure.sectionC.type, 'C', structure.sectionC.marksEach, structure.sectionC.promptHint, structure.sectionC.multiPart)

  // ── 6. Format into exam question schema ───────────────────────
  return {
    sectionA: formatSection(finalA, 'A', 1),
    sectionB: formatSection(finalB, 'B', 2),  // numbering continues from A
    sectionC: formatSection(finalC, 'C', 3),  // continues from B
    sectionCAnswerCount: structure.sectionCAnswerCount,
  }
}

// ── Fetch questions for a section from the database ────────────
// sectionConfig.fetchBy selects the filter strategy:
// - 'typeSection' (default, every generic-structure subject): match
//   on the question's type + section fields, as always.
// - 'marks': match on the question's marks value instead — used for
//   BECE Computing's Section B/C, where real transcribed questions
//   already carry the correct marks (24 / 12) but inconsistent
//   type/section tags, so marks is the reliable signal.
const fetchSectionQuestions = async (
  subject, examType, sectionConfig, section, fetchCount, masteryMap
) => {
  const filter = { subject, examType, isActive: true }

  if (sectionConfig.fetchBy === 'marksTypeSection') {
    // Like 'marksAndType', plus `section` — needed when two sections of
    // the same subject share BOTH marksEach AND type (e.g. BECE Social
    // Studies: sectionB's compulsory Environment question and sectionC's
    // Law/Order+Socio-Economic questions are both 20-mark multi-part
    // items), so only `section` still tells them apart. Also shields
    // against pre-existing bank content tagged under an older generic
    // structure (different marks/type) for the same subject.
    filter.marks   = sectionConfig.marksEach
    filter.type    = sectionConfig.type
    filter.section = section
  } else if (sectionConfig.fetchBy === 'marksAndType') {
    // Like 'marks', but also filters on `type` — needed when two
    // sections of the same subject coincidentally share a marksEach
    // value (e.g. BECE English Language: sectionB's compulsory
    // Comprehension+Literature item and sectionC's Essay questions are
    // both 30 marks), so a plain marks-only filter would pull sectionC's
    // essay topics into sectionB's fetch pool and vice versa.
    filter.marks = sectionConfig.marksEach
    filter.type  = sectionConfig.type
  } else if (sectionConfig.fetchBy === 'marks') {
    filter.marks = sectionConfig.marksEach
  } else {
    filter.type    = sectionConfig.type
    filter.section = section
  }

  return Question.find(filter)
    .limit(fetchCount)
    .lean()
}

// ── Weighted random selection ──────────────────────────────────
// Topics with higher weight (lower mastery) are more likely
// to be selected for the paper.
const weightedSelect = (questions, count, getWeight) => {
  if (questions.length <= count) return questions

  const pool     = [...questions]
  const selected = []

  while (selected.length < count && pool.length > 0) {
    // Calculate total weight
    const totalWeight = pool.reduce((sum, q) => sum + getWeight(q.topic), 0)
    let rand          = Math.random() * totalWeight

    // Pick a question based on weight
    for (let i = 0; i < pool.length; i++) {
      rand -= getWeight(pool[i].topic)
      if (rand <= 0) {
        selected.push(pool.splice(i, 1)[0])
        break
      }
    }
  }

  return selected
}

// ── Make part marks add up to a question's total ───────────────
// Scales the parts proportionally (largest-remainder rounding) when
// they don't already sum to `total`, keeping every part at least 1 mark
// where the total allows. Parts already summing correctly, and questions
// without parts, are returned unchanged.
export const fitPartMarks = (parts, total) => {
  if (!Array.isArray(parts) || parts.length === 0 || !(total > 0)) return parts || []
  const marks = parts.map(p => Math.max(0, Number(p.marks) || 0))
  const sum = marks.reduce((s, m) => s + m, 0)
  if (sum === total) return parts
  const weights = sum > 0 ? marks : marks.map(() => 1)
  const wSum = weights.reduce((s, w) => s + w, 0)
  const exact = weights.map(w => (w / wSum) * total)
  const floor = exact.map(Math.floor)
  let left = total - floor.reduce((s, m) => s + m, 0)
  exact.map((e, i) => [e - floor[i], i]).sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => { if (left > 0) { floor[i]++; left-- } })
  // No zero-mark parts when there are enough marks to go round
  if (total >= parts.length) {
    for (let i = 0; i < floor.length; i++) {
      if (floor[i] === 0) {
        const donor = floor.indexOf(Math.max(...floor))
        floor[donor]--; floor[i]++
      }
    }
  }
  return parts.map((p, i) => ({ ...p, marks: floor[i] }))
}

// ── Fill gaps with AI-generated questions ─────────────────────
// If the question bank doesn't have enough questions for a
// section, Gemini generates the remaining ones. `multiPart` (not
// `type`, which is only ever 'MCQ'/'Essay' now) decides whether this
// section's Essay questions get a lettered, marks-summing `parts`
// breakdown (what used to be signalled by `type: 'Structured'`) or a
// single free-response essay with `parts: []`.
const fillWithAI = async (
  existing, needed, subject, examType, type, section, marksEach, promptHint, multiPart
) => {
  if (existing.length >= needed) return existing.slice(0, needed)

  const gap = needed - existing.length
  if (gap === 0) return existing

  const systemPrompt = `You are a WAEC chief examiner generating exam questions.
Generate questions that exactly match WAEC ${examType} ${subject} standard.
Respond with valid JSON only. No markdown.`

  const prompt = `Generate ${gap} ${type} question(s) for a WAEC ${examType} ${subject} exam.
Section ${section} — ${marksEach} mark(s) each.${multiPart && type !== 'MCQ' ? `
The "marks" of all parts of a question must add up to exactly ${marksEach}.` : ''}
Make questions exam-standard, clear, and at appropriate difficulty.
${promptHint ? `\n${promptHint}\n` : ''}
${type === 'MCQ' ? `Return JSON array:
[{
  "questionText": "...",
  "options": ["option A text", "option B text", "option C text", "option D text"],
  "correctOption": "A",
  "modelAnswer": "",
  "topic": "topic name",
  "parts": []
}]` : multiPart ? `If a part naturally divides further (e.g. part (a) has two
distinct sub-questions), use a dotted leaf label combining them —
"a.i", "a.ii", "b.i" — each with only its own share of the marks,
instead of one entry for the whole of (a). A part with no further
division just keeps its own letter, e.g. "b".
Return JSON array:
[{
  "questionText": "...",
  "options": [],
  "correctOption": "",
  "modelAnswer": "Detailed marking guide with key points",
  "topic": "topic name",
  "parts": [
    {"part": "a", "text": "...", "marks": 4, "answer": "..."},
    {"part": "b.i", "text": "...", "marks": 2, "answer": "..."},
    {"part": "b.ii", "text": "...", "marks": 1, "answer": "..."}
  ]
}]` : `Return JSON array:
[{
  "questionText": "Write an essay on...",
  "options": [],
  "correctOption": "",
  "modelAnswer": "Essay marking guide covering all key criteria",
  "topic": "topic name",
  "parts": []
}]`}`

  try {
    const generated = await generateAIJSON(prompt, systemPrompt)
    const aiQuestions = Array.isArray(generated) ? generated : []

    // Tag AI-generated questions. Part marks are forced to add up to the
    // section's marksEach — the model doesn't always comply, and a 40-mark
    // question whose parts total 12 caps every student at 12/40.
    const tagged = aiQuestions.map(q => ({
      ...q,
      parts: fitPartMarks(q.parts, marksEach),
      isAIGenerated: true,
      subject,
      examType,
      type,
      section,
      marks:      marksEach,
      difficulty: 3,
      year:       new Date().getFullYear(),
    }))

    return [...existing, ...tagged].slice(0, needed)
  } catch (err) {
    console.error('[MockGenerator] AI fill failed:', err.message)
    return existing  // return what we have if AI fails
  }
}

// ── Format questions into exam schema ──────────────────────────
const formatSection = (questions, section, startNumber) => {
  return questions.map((q, idx) => ({
    questionId:     q._id || null,
    section,
    type:           q.type,
    questionNumber: startNumber + idx,
    questionText:   q.questionText,
    options:        q.options   || [],
    correctOption:  q.correctOption || '',
    modelAnswer:    q.modelAnswer   || '',
    marks:          q.marks,
    topic:          q.topic,
    hasImage:       q.hasImage  || false,
    imageData:      q.imageData || '',
    parts:          q.parts    || [],
    studentAnswer:  '',
    marksAwarded:   null,
    isCorrect:      null,
    aiFeedback:     '',
    partResults:    [],
  }))
}

// ── Batch AI marker for all non-MCQ answers ────────────────────
// Called after student submits the full paper.
// Sends all structured and essay answers to Gemini in one call
// to be more efficient than individual calls per question.
export const markFullPaper = async (exam) => {
  const subject = exam.subject
  const structure = getPaperStructure(exam.examType, exam.subject)

  // ── Section A: instant MCQ marking ───────────────────────────
  let sectionAMarks = 0
  const markedA = exam.sectionA.map(q => {
    const isCorrect = q.studentAnswer?.toUpperCase() ===
                      q.correctOption?.toUpperCase()
    const marksAwarded = isCorrect ? q.marks : 0
    sectionAMarks += marksAwarded
    return { ...q.toObject ? q.toObject() : q, isCorrect, marksAwarded, aiFeedback: '' }
  })

  // ── Section B + C: AI marking ─────────────────────────────────
  const nonMCQ = [
    ...exam.sectionB.map((q, i) => ({ ...q.toObject ? q.toObject() : q, _sectionKey: 'B', _idx: i })),
    ...exam.sectionC.map((q, i) => ({ ...q.toObject ? q.toObject() : q, _sectionKey: 'C', _idx: i })),
  ].filter(q => q.studentAnswer && q.studentAnswer.trim().length > 0)

  let sectionBMarks = 0
  let sectionCMarks = 0

  const markedB = exam.sectionB.map(q => ({
    ...q.toObject ? q.toObject() : q,
    marksAwarded: 0, isCorrect: false, aiFeedback: 'Not attempted', partResults: [],
  }))
  const markedC = exam.sectionC.map(q => ({
    ...q.toObject ? q.toObject() : q,
    marksAwarded: 0, isCorrect: false, aiFeedback: 'Not attempted', partResults: [],
  }))

  if (nonMCQ.length > 0) {
    const systemPrompt = `You are a WAEC ${subject} chief examiner marking student exam scripts.
Award marks strictly according to the marking guides provided.
Award partial marks where students show partial understanding.
Be fair, consistent, and examiner-standard in all feedback.
Respond with valid JSON only.`

    // Photographed answers: their pages go to the AI too, numbered in
    // order, and each question lists which page numbers are its own.
    const images = []
    const questionsForAI = nonMCQ.map(q => {
      const scopeNote = formatScopeNote(getCurriculumScope(subject, q.topic))
      const pages = q.wasScanned
        ? (q.scannedFiles || []).map(f => images.push({ data: f.data, mimeType: f.mimeType }))
        : []
      return {
        section:       q._sectionKey,
        index:         q._idx,
        questionText:  q.questionText,
        marks:         q.marks,
        modelAnswer:   q.modelAnswer,
        parts:         q.parts,
        studentAnswer: q.studentAnswer,
        type:          q.type,
        ...(pages.length > 0 && { scannedPages: pages }),
        ...(scopeNote && { curriculumNote: scopeNote }),
      }
    })

    const PAGES_NOTE = images.length > 0 ? `
Some answers were handwritten and photographed: ${images.length} page(s) are attached in order, and
a question's "scannedPages" lists its page numbers (1 = first attached page). For those questions
the studentAnswer is an AI transcription that may describe or miss diagrams — read the pages as the
authoritative answer and mark any diagram, graph, table or sketch from them.` : ''
    const prompt = `Mark these ${subject} exam answers. For each question return marks and feedback.
If a question includes a "curriculumNote", grade strictly within that syllabus scope.${PAGES_NOTE}

Questions and student answers:
${JSON.stringify(questionsForAI, null, 2)}

Return a JSON array with one object per question:
[
  {
    "section": "B",
    "index": 0,
    "marksAwarded": 7,
    "marksAvailable": 10,
    "isCorrect": false,
    "aiFeedback": "Examiner comment on this answer",
    "partResults": [
      {"part": "a", "marksAwarded": 3, "marksAvailable": 4, "feedback": "..."},
      {"part": "b", "marksAwarded": 2, "marksAvailable": 3, "feedback": "..."},
      {"part": "c", "marksAwarded": 2, "marksAvailable": 3, "feedback": "..."}
    ]
  }
]`

    try {
      let aiResults
      try {
        aiResults = images.length > 0
          ? await generateAIJSONWithImages(prompt, systemPrompt, images)
          : await generateAIJSON(prompt, systemPrompt)
      } catch (err) {
        if (images.length === 0) throw err
        console.error('[MockMarker] Marking with scanned pages failed, using transcriptions only:', err.message)
        aiResults = await generateAIJSON(prompt.replace(PAGES_NOTE, ''), systemPrompt)
      }

      if (Array.isArray(aiResults)) {
        aiResults.forEach(result => {
          const { section, index, marksAwarded, isCorrect, aiFeedback, partResults } = result

          if (section === 'B' && markedB[index] !== undefined) {
            markedB[index] = {
              ...markedB[index],
              marksAwarded: marksAwarded || 0,
              isCorrect:    isCorrect    || false,
              aiFeedback:   aiFeedback   || '',
              partResults:  partResults  || [],
            }
            sectionBMarks += marksAwarded || 0
          }

          if (section === 'C' && markedC[index] !== undefined) {
            markedC[index] = {
              ...markedC[index],
              marksAwarded: marksAwarded || 0,
              isCorrect:    isCorrect    || false,
              aiFeedback:   aiFeedback   || '',
              partResults:  partResults  || [],
            }
            sectionCMarks += marksAwarded || 0
          }
        })
      }
    } catch (err) {
      console.error('[MockMarker] AI marking failed:', err.message)
    }
  }

  // Per-section scaling — most subjects leave this at 1 (a no-op), but
  // some (e.g. BECE French: WAEC scales its 40-mark Objective paper ×1.5
  // to 60 when the Oral paper is on hold) have a real, official scaling
  // factor that's visible even in the per-section breakdown, not just
  // the final total. Applied before summing so both the earned marks and
  // the section's own total are reported already-scaled, matching how
  // WAEC itself reports it.
  const sectionAScale = structure.sectionA.scalingFactor || 1
  const sectionBScale = structure.sectionB.scalingFactor || 1
  const sectionCScale = structure.sectionC.scalingFactor || 1

  const scaledSectionAMarks = Math.round(sectionAMarks * sectionAScale)
  const scaledSectionBMarks = Math.round(sectionBMarks * sectionBScale)
  const scaledSectionCMarks = Math.round(sectionCMarks * sectionCScale)
  const scaledSectionATotal = Math.round(structure.sectionA.totalMarks * sectionAScale)
  const scaledSectionBTotal = Math.round(structure.sectionB.totalMarks * sectionBScale)
  const scaledSectionCTotal = Math.round(structure.sectionC.totalMarks * sectionCScale)

  // Raw earned/available on the paper's own (now per-section-scaled)
  // basis — most subjects sum to 100 already, but some (e.g. BECE
  // Science: 40+40+60=140) don't, so the final headline total/percent is
  // normalized onto a 100 basis here.
  const rawEarned      = scaledSectionAMarks + scaledSectionBMarks + scaledSectionCMarks
  const rawAvailable   = scaledSectionATotal + scaledSectionBTotal + scaledSectionCTotal
  const availableMarks = 100
  const totalMarks     = Math.round((rawEarned / rawAvailable) * 100)
  const percent        = totalMarks

  return {
    markedA,
    markedB,
    markedC,
    sectionAMarks: scaledSectionAMarks,
    sectionBMarks: scaledSectionBMarks,
    sectionCMarks: scaledSectionCMarks,
    sectionATotal: scaledSectionATotal,
    sectionBTotal: scaledSectionBTotal,
    sectionCTotal: scaledSectionCTotal,
    totalMarks,
    availableMarks,
    percent,
  }
}

// ── Generate overall examiner comment ─────────────────────────
export const generateExaminerComment = async (
  subject, totalMarks, availableMarks, sectionAMarks, sectionBMarks, sectionCMarks,
  sectionATotal = 40, sectionBTotal = 40, sectionCTotal = 20
) => {
  const percent = Math.round((totalMarks / availableMarks) * 100)

  const systemPrompt = `You are the chief WAEC ${subject} examiner writing a post-examination
candidate report. Write in formal examiner language.
Respond with plain text only — no JSON, no markdown.`

  const prompt = `Write a 3-sentence examiner comment for a candidate who scored:
- Section A (MCQ): ${sectionAMarks}/${sectionATotal}
- Section B: ${sectionBMarks}/${sectionBTotal}
- Section C (Essay): ${sectionCMarks}/${sectionCTotal}
- Total: ${totalMarks}/100 (${percent}%)

Comment on their overall performance, strongest section,
and the area most in need of improvement.
Write as if this will appear on their official result report.`

  try {
    // Plain-text call: the prompt asks for prose, not JSON. Routing it
    // through generateAIJSON made the parse/repair step mangle the comment
    // into a non-string, which submitExam then stored as ''.
    const comment = (await generateAIResponse(prompt, systemPrompt)).trim()
    if (comment) return comment
    throw new Error('empty examiner comment')
  } catch {
    const grade =
      percent >= 75 ? 'excellent' :
      percent >= 60 ? 'satisfactory' :
      percent >= 40 ? 'below expectations' : 'unsatisfactory'
    return `The candidate demonstrated ${grade} performance in this ${subject} examination, ` +
           `scoring ${totalMarks} out of 100 marks. ` +
           `Further practice is recommended across all sections.`
  }
}