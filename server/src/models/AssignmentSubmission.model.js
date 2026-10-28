import mongoose from 'mongoose'

// One answer, indexed to line up by position with the parent
// Assignment's `questions` array — not a duplicated question snapshot.
const assignmentAnswerSchema = new mongoose.Schema({
  studentAnswer: { type: String, default: '' },
  marksAwarded:  { type: Number, default: null },
  // The AI's own mark, kept unchanged when a teacher overrides
  // marksAwarded during review — so AI and teacher marks can be compared.
  aiMarksAwarded: { type: Number, default: null },
  isCorrect:     { type: Boolean, default: null },
  aiFeedback:    { type: String, default: '' },
  // Set when this answer came from a photo/PDF transcription rather
  // than being typed — kept true even if the student edits the text
  // afterward. Any submission with at least one scanned answer routes
  // to teacher review instead of instant marking (see submitSubmission).
  wasScanned:    { type: Boolean, default: false },
  // The actual scanned file(s), kept so the teacher can review the
  // real handwritten work during review, not just the AI's
  // transcription — multiple entries means multiple photo pages; a
  // single entry with mimeType 'application/pdf' means a PDF instead.
  scannedFiles: [{
    data:     String,  // base64
    mimeType: String,
  }],
  partResults: [{
    part:           String,
    marksAwarded:   Number,
    marksAvailable: Number,
    feedback:       String,
  }],
}, { _id: false })

// ── AssignmentSubmission ─────────────────────────────────────────
// One per student per assignment, created eagerly for every student
// in the class at assignment-creation time — so a teacher sees
// "0/25 submitted" immediately, and a student's pending-assignment
// badge count is a simple query with no join needed.
const assignmentSubmissionSchema = new mongoose.Schema(
  {
    assignmentId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Assignment',
      required: true,
      index:    true,
    },
    studentId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true,
    },

    status: {
      type:    String,
      // 'pending_review' sits between 'submitted' and 'marked' — only
      // reached when at least one answer was photo-scanned (see
      // submitSubmission); typed/MCQ-only submissions skip straight to
      // 'marked' with instant AI marking, unchanged from Phase 1.
      enum:    ['assigned', 'in_progress', 'submitted', 'pending_review', 'marked'],
      default: 'assigned',
    },

    answers: [assignmentAnswerSchema],

    // For a PDF-handout assignment (Assignment.format === 'file') —
    // the student's whole solved work as one or more photo pages, or a
    // single PDF, instead of per-question answers. There's nothing to
    // auto-mark against a free-form document, so a file-format
    // submission always routes straight to 'pending_review' on submit
    // (see submitFileAssignment) and is graded manually via
    // totalMarks/teacherFeedback below, not per-question.
    submissionFiles: [{
      data:     String,  // base64
      mimeType: String,
      filename: String,
    }],
    teacherFeedback: { type: String, default: '' },

    totalMarks:     { type: Number, default: 0 },
    availableMarks: { type: Number, default: 0 },
    percent:        { type: Number, default: 0 },

    submittedAt: { type: Date, default: null },
    markedAt:    { type: Date, default: null },
  },
  { timestamps: true }
)

assignmentSubmissionSchema.index({ studentId: 1, status: 1 })
assignmentSubmissionSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true })

const AssignmentSubmission = mongoose.model('AssignmentSubmission', assignmentSubmissionSchema)
export default AssignmentSubmission
