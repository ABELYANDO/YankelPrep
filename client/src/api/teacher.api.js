import api from './client'

export const teacherAPI = {
  // ── Classes ──────────────────────────────────────────────────
  createClass: (data) => api.post('/teacher/classes', data),
  getClasses:  ()     => api.get('/teacher/classes'),
  deleteClass: (classId) => api.delete(`/teacher/classes/${classId}`),
  removeStudent: (classId, studentId) => api.delete(`/teacher/classes/${classId}/students/${studentId}`),

  // ── Class analytics — dashboard + CSV export of the same data ─────
  getClassAnalytics:   (classId) => api.get(`/teacher/classes/${classId}/analytics`),
  exportClassResults:  (classId) => api.get(`/teacher/classes/${classId}/export`, { responseType: 'blob' }),

  // ── Announcements ────────────────────────────────────────────────
  createAnnouncement: (classId, message) => api.post(`/teacher/classes/${classId}/announcements`, { message }),
  getClassAnnouncements: (classId) => api.get(`/teacher/classes/${classId}/announcements`),
  deleteAnnouncement: (id) => api.delete(`/teacher/announcements/${id}`),

  // ── Question tools — same endpoints/behaviour as the admin panel,
  // just mounted under /teacher and scoped to the teacher's own use ──
  generateQuestions: (config) => api.post('/teacher/generate-questions', config),
  extractFromPDF:    (data)   => api.post('/teacher/extract-pdf', data, { timeout: 120000 }),

  // ── Assignments ──────────────────────────────────────────────
  createAssignment: (data)    => api.post('/teacher/assignments', data),
  getAssignments:   (classId) => api.get('/teacher/assignments', { params: classId ? { classId } : {} }),
  updateAssignment: (id, data) => api.put(`/teacher/assignments/${id}`, data),
  deleteAssignment: (id)      => api.delete(`/teacher/assignments/${id}`),
  assignToNewStudents: (id)   => api.post(`/teacher/assignments/${id}/assign-new-students`),
  getAssignmentSubmissions: (id) => api.get(`/teacher/assignments/${id}/submissions`),

  // ── Struggling-topics view for one student, one subject ────────
  getStudentMastery: (studentId, subject) => api.get(`/teacher/students/${studentId}/mastery`, { params: { subject } }),

  // ── Submission review (Phase 2 — scanned answers) ─────────────
  getPendingReviews:      ()   => api.get('/teacher/submissions'),
  getSubmissionForReview: (id) => api.get(`/teacher/submissions/${id}`),
  // `payload` is either { answers } for a question-based assignment's
  // per-question overrides, or { totalMarks, teacherFeedback } for a
  // PDF-handout one (see publishSubmission's server-side branch).
  publishSubmission:      (id, payload) => api.post(`/teacher/submissions/${id}/publish`, payload),

  // ── Mock exam review (Section B/C photo-scanned answers) ───────
  getPendingMockExams:    ()   => api.get('/teacher/mock-exams'),
  getMockExamForReview:   (id) => api.get(`/teacher/mock-exams/${id}`),
  publishMockExamReview:  (id, overrides) => api.post(`/teacher/mock-exams/${id}/publish`, { overrides }),
}
