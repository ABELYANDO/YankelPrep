import { Router } from 'express'
import {
  createClass,
  listClasses,
  deleteClass,
  removeStudent,
  createAssignment,
  listAssignments,
  listAssignmentSubmissions,
  updateAssignment,
  deleteAssignment,
  assignToNewStudents,
  getClassAnalytics,
  exportClassResults,
  createAnnouncement,
  listClassAnnouncements,
  deleteAnnouncement,
  getStudentMastery,
  listPendingReviews,
  getSubmissionForReview,
  publishSubmission,
  listPendingMockExams,
  getMockExamForReview,
  publishMockExamReview,
} from '../controllers/teacher.controller.js'
import { generateQuestions, extractFromPDF } from '../controllers/aiQuestions.controller.js'
import { protect, restrictTo } from '../middleware/auth.middleware.js'

const router = Router()

router.use(protect)
router.use(restrictTo('teacher'))

// ── Classes ──────────────────────────────────────────────────────
router.post('/classes', createClass)
router.get('/classes',  listClasses)
router.delete('/classes/:classId', deleteClass)
router.delete('/classes/:classId/students/:studentId', removeStudent)
router.get('/classes/:classId/analytics', getClassAnalytics)
router.get('/classes/:classId/export',    exportClassResults)

// ── Announcements ──────────────────────────────────────────────────
router.post('/classes/:classId/announcements', createAnnouncement)
router.get('/classes/:classId/announcements',  listClassAnnouncements)
router.delete('/announcements/:id',            deleteAnnouncement)

// ── Question tools — same side-effect-free preview generators the
// admin PDF Extractor / AI Generator already use, reused unmodified ──
router.post('/generate-questions', generateQuestions)
router.post('/extract-pdf',        extractFromPDF)

// ── Assignments ──────────────────────────────────────────────────
router.post('/assignments', createAssignment)
router.get('/assignments',  listAssignments)
router.get('/assignments/:id/submissions', listAssignmentSubmissions)
router.put('/assignments/:id',    updateAssignment)
router.delete('/assignments/:id', deleteAssignment)
router.post('/assignments/:id/assign-new-students', assignToNewStudents)

// ── Struggling-topics view for one student, one subject ──────────
router.get('/students/:studentId/mastery', getStudentMastery)

// ── Submission review (Phase 2 — scanned answers) ────────────────
router.get('/submissions',              listPendingReviews)
router.get('/submissions/:id',          getSubmissionForReview)
router.post('/submissions/:id/publish', publishSubmission)

// ── Mock exam review (Section B/C photo-scanned answers) ─────────
router.get('/mock-exams',               listPendingMockExams)
router.get('/mock-exams/:id',           getMockExamForReview)
router.post('/mock-exams/:id/publish',  publishMockExamReview)

export default router
