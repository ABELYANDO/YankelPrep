import User         from '../models/User.model.js'
import ExamSchedule from '../models/ExamSchedule.model.js'
import bcrypt  from 'bcryptjs'
import { asyncHandler, AppError } from '../middleware/error.middleware.js'
import {
  getAllBadgesWithStatus,
  getBadgeDetails,
  checkAndAwardBadges,
  updateStreak,
} from '../utils/badge.utils.js'

// ── GET /api/settings/profile ──────────────────────────────────
// Returns the full profile for the settings page,
// including all badges with earned/not-earned status.
export const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id)
    .select('-password')
    .lean()

  if (!user) throw new AppError('User not found', 404)

  const allBadges = getAllBadgesWithStatus(user.badges || [])
  const earned    = allBadges.filter(b => b.earned)
  const locked    = allBadges.filter(b => !b.earned)

  const accuracy = user.totalQuestionsAnswered > 0
    ? Math.round((user.totalCorrect / user.totalQuestionsAnswered) * 100)
    : 0

  res.json({
    success: true,
    profile: {
      ...user,
      accuracy,
      badgesEarned:  earned,
      badgesLocked:  locked,
      totalBadges:   allBadges.length,
    },
  })
})

// ── PUT /api/settings/profile ──────────────────────────────────
// Updates editable profile fields: name, school, subjects, examType.
export const updateProfile = asyncHandler(async (req, res) => {
  const { fullName, school, examType, subjects } = req.body

  // Validate subjects is an array if provided
  if (subjects && !Array.isArray(subjects)) {
    throw new AppError('Subjects must be an array', 400)
  }

  const updates = {}
  if (fullName)  updates.fullName  = fullName.trim()
  if (school)    updates.school    = school.trim()
  if (examType)  updates.examType  = examType
  if (subjects)  updates.subjects  = subjects

  const user = await User.findByIdAndUpdate(
    req.user._id,
    updates,
    { new: true, runValidators: true }
  ).select('-password')

  if (!user) throw new AppError('User not found', 404)

  res.json({
    success: true,
    message: 'Profile updated successfully',
    user:    user.toSafeObject ? user.toSafeObject() : user,
  })
})

// ── PUT /api/settings/password ─────────────────────────────────
// Changes the student's password after verifying the current one.
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body

  if (!currentPassword || !newPassword) {
    throw new AppError('Both current and new password are required', 400)
  }

  if (newPassword.length < 6) {
    throw new AppError('New password must be at least 6 characters', 400)
  }

  if (currentPassword === newPassword) {
    throw new AppError('New password must be different from current password', 400)
  }

  // Fetch with password (normally excluded by select: false)
  const user = await User.findById(req.user._id).select('+password')
  if (!user) throw new AppError('User not found', 404)

  // Verify current password. 400, not 401: the client treats any 401 as
  // an expired session and logs the user out, which would bounce them
  // to /login for a simple typo instead of showing this message.
  const isMatch = await bcrypt.compare(currentPassword, user.password)
  if (!isMatch) throw new AppError('Current password is incorrect', 400)

  // Set new password — the model pre-save hook will hash it
  user.password = newPassword
  await user.save()

  res.json({
    success: true,
    message: 'Password changed successfully',
  })
})

// ── GET /api/settings/badges ───────────────────────────────────
// Returns all badges for the authenticated student with earned status.
export const getBadges = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id)
    .select('badges')
    .lean()

  const allBadges = getAllBadgesWithStatus(user?.badges || [])

  res.json({
    success: true,
    badges:  allBadges,
    earned:  allBadges.filter(b => b.earned).length,
    total:   allBadges.length,
  })
})

// ── POST /api/settings/badges/check ───────────────────────────
// Manually triggers a badge check for the student.
// Called after significant events on the frontend.
export const triggerBadgeCheck = asyncHandler(async (req, res) => {
  const newBadges = await checkAndAwardBadges(req.user._id)
  const details   = getBadgeDetails(newBadges)

  res.json({
    success:     true,
    newBadges:   details,
    count:       newBadges.length,
    message:     newBadges.length > 0
      ? `You earned ${newBadges.length} new badge${newBadges.length > 1 ? 's' : ''}!`
      : 'No new badges this time — keep going!',
  })
})

// ── POST /api/settings/streak/update ──────────────────────────
// Updates the student's streak. Called server-side after sessions.
export const refreshStreak = asyncHandler(async (req, res) => {
  const newStreak = await updateStreak(req.user._id)

  res.json({
    success:   true,
    streak:    newStreak,
    message:   newStreak > 1
      ? `${newStreak} day streak — keep it up!`
      : 'Streak started — come back tomorrow!',
  })
})

// ── GET /api/settings/exam-schedule ────────────────────────────
// This cycle's WASSCE/BECE dates, set by an admin (see
// updateExamSchedule below) — read by any logged-in user so the
// student dashboard can show a "days until your exam" countdown.
// Either date can be null if an admin hasn't set it yet.
export const getExamSchedule = asyncHandler(async (req, res) => {
  const schedule = await ExamSchedule.findOne({}).lean()

  res.json({
    success:    true,
    wassceDate: schedule?.wassceDate || null,
    beceDate:   schedule?.beceDate   || null,
  })
})

// ── PUT /api/admin/exam-schedule ───────────────────────────────
// Admin-only (mounted under admin.routes.js) — sets this cycle's
// WASSCE/BECE dates. Upserts the singleton document since there's
// only ever one; either field is optional so one can be updated
// without touching the other.
export const updateExamSchedule = asyncHandler(async (req, res) => {
  const { wassceDate, beceDate } = req.body

  const updates = {}
  if (wassceDate !== undefined) updates.wassceDate = wassceDate || null
  if (beceDate   !== undefined) updates.beceDate   = beceDate   || null

  const schedule = await ExamSchedule.findOneAndUpdate(
    {},
    { $set: updates },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )

  res.json({
    success:    true,
    message:    'Exam schedule updated',
    wassceDate: schedule.wassceDate,
    beceDate:   schedule.beceDate,
  })
})