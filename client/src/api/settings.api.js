import api from './client'

export const settingsAPI = {
  getProfile:       ()     => api.get('/settings/profile'),
  updateProfile:    (data) => api.put('/settings/profile', data),
  changePassword:   (data) => api.put('/settings/password', data),
  changeEmail:      (data) => api.put('/settings/email', data),
  getBadges:        ()     => api.get('/settings/badges'),
  checkBadges:      ()     => api.post('/settings/badges/check'),
  updateStreak:     ()     => api.post('/settings/streak/update'),
  getExamSchedule:  ()     => api.get('/settings/exam-schedule'),
}