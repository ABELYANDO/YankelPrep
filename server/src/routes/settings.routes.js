import { Router } from 'express'
import {
  getProfile,
  updateProfile,
  changePassword,
  changeEmail,
  getBadges,
  triggerBadgeCheck,
  refreshStreak,
  getExamSchedule,
} from '../controllers/settings.controller.js'
import { protect } from '../middleware/auth.middleware.js'

const router = Router()

router.use(protect)

router.get('/profile',          getProfile)
router.put('/profile',          updateProfile)
router.put('/password',         changePassword)
router.put('/email',            changeEmail)
router.get('/badges',           getBadges)
router.post('/badges/check',    triggerBadgeCheck)
router.post('/streak/update',   refreshStreak)
router.get('/exam-schedule',    getExamSchedule)

export default router