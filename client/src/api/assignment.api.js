import api from './client'

export const assignmentAPI = {
  joinClass:  (joinCode) => api.post('/assignments/join', { joinCode }),
  getClasses: ()         => api.get('/assignments/classes'),
  leaveClass: (classId)  => api.post(`/assignments/classes/${classId}/leave`),

  getMyAssignments: (subject) => api.get('/assignments', { params: subject ? { subject } : {} }),
  getAnnouncements: () => api.get('/assignments/announcements'),
  getPendingCount:  ()        => api.get('/assignments/pending-count'),
  getSubmission:    (submissionId) => api.get(`/assignments/${submissionId}`),
  // scannedFiles left undefined (typed edits) is omitted from the body, so
  // the server keeps the pages already attached; [] explicitly clears them.
  saveAnswer:       (submissionId, questionIndex, studentAnswer, wasScanned = false, scannedFiles) =>
    api.patch(`/assignments/${submissionId}/answer`, { questionIndex, studentAnswer, wasScanned, scannedFiles }),
  submit:           (submissionId) => api.post(`/assignments/${submissionId}/submit`),
  // PDF-handout assignments (format 'file') — send the student's whole
  // solved-work file set instead of per-question answers.
  submitFile:       (submissionId, files) => api.post(`/assignments/${submissionId}/submit-file`, { files }),

  // Vision transcription can take a few seconds longer than a typical
  // call, more so for a multi-page PDF — same reasoning as the PDF/photo
  // extraction timeouts elsewhere.
  extractAnswerFromPhoto: (files, questionText) =>
    api.post('/assignments/extract-photo', { files, questionText }, { timeout: 90000 }),
}
