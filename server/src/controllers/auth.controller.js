import crypto from 'crypto'
import User from '../models/User.model.js'
import { generateToken } from '../utils/jwt.js'
import { sendPasswordResetEmail, domainAcceptsMail, findDomainTypo } from '../utils/email.utils.js'
import { asyncHandler, AppError } from '../middleware/error.middleware.js'

// The User model stores emails trimmed and lower-cased, so every lookup
// must normalise the same way — otherwise "Ama@Gmail.com" can register
// but never log in. Anything that isn't a string becomes '' so a body
// like { "email": { "$ne": null } } can't reach a query as an operator.
const normalizeEmail = (value) =>
  typeof value === 'string' ? value.trim().toLowerCase() : ''

// ── POST /api/auth/register ────────────────────────────────────
export const register = asyncHandler(async (req, res) => {
  const { fullName, password, school, examType, subjects } = req.body
  const email = normalizeEmail(req.body.email)
  if (!email) throw new AppError('Email is required.', 400)

  // 1. Check if email already registered
  const existing = await User.findOne({ email })
  if (existing) throw new AppError('Email already registered.', 409)

  // 1b. Catch a typo of a well-known provider (e.g. gmial.com) before
  // the MX check — typo-squatted domains often have real mail servers
  // set up deliberately, so domainAcceptsMail alone would let them through.
  const typoOf = findDomainTypo(email)
  if (typoOf) {
    throw new AppError(`Did you mean ${email.split('@')[0]}@${typoOf}? Please check your email address.`, 400)
  }

  // 1c. Confirm the domain can actually receive mail — password reset
  // depends on it later, so reject typo/fake domains up front.
  if (!(await domainAcceptsMail(email))) {
    throw new AppError("We couldn't verify that email's domain. Please check for typos.", 400)
  }

  // 2. Create the user (password is hashed automatically by the model)
  const user = await User.create({
    fullName,
    email,
    password,
    school,
    examType,
    subjects,
  })

  // 3. Generate JWT
  const token = generateToken(user._id, user.role)

  // 4. Send response
  res.status(201).json({
    success: true,
    message: 'Account created successfully!',
    token,
    user: user.toSafeObject(),
  })
})

// ── POST /api/auth/login ───────────────────────────────────────
// Student login. Same "never reveal which case it was" guard as
// adminLogin/teacherLogin — a teacher or admin entering correct
// credentials here still gets the identical generic error, not a
// successful login into the wrong portal.
export const login = asyncHandler(async (req, res) => {
  const { password } = req.body
  const email = normalizeEmail(req.body.email)

  // 1. Validate inputs
  if (!email || !password) {
    throw new AppError('Email and password are required.', 400)
  }

  // 2. Find user — we need password so we explicitly select it back
  const user = await User.findOne({ email }).select('+password')
  if (!user) throw new AppError('Invalid email or password. Please try again.', 401)

  // 3. Check password
  const isMatch = await user.comparePassword(password)
  if (!isMatch) throw new AppError('Invalid email or password. Please try again.', 401)

  // 3b. Must actually be a student account
  if (user.role !== 'student') {
    throw new AppError('Invalid email or password. Please try again.', 401)
  }

  // 4. Update last active
  user.lastActive = new Date()
  await user.save({ validateBeforeSave: false })

  // 5. Generate JWT and respond
  const token = generateToken(user._id, user.role)

  res.json({
    success: true,
    message: 'Login successful!',
    token,
    user: user.toSafeObject(),
  })
})

// ── GET /api/auth/me ───────────────────────────────────────────
// Returns the currently logged-in user's profile.
// Protected — requires valid JWT.
export const getMe = asyncHandler(async (req, res) => {
  // req.user is set by the protect middleware
  const user = await User.findById(req.user._id)
  res.json({
    success: true,
    user: user.toSafeObject(),
  })
})

// ── POST /api/auth/admin-login ─────────────────────────────────
// Separate from student login. Succeeds only for accounts with
// role 'admin' — a valid student password still fails here, and
// the response never reveals which case it was (no such account,
// wrong password, or a real student account) to avoid leaking
// account existence/role.
export const adminLogin = asyncHandler(async (req, res) => {
  const { password } = req.body
  const email = normalizeEmail(req.body.email)

  if (!email || !password) {
    throw new AppError('Email and password are required.', 400)
  }

  const user    = await User.findOne({ email }).select('+password')
  const isMatch = user ? await user.comparePassword(password) : false

  if (!user || !isMatch || user.role !== 'admin') {
    throw new AppError('Invalid email or password. Please try again.', 401)
  }

  user.lastActive = new Date()
  await user.save({ validateBeforeSave: false })

  const token = generateToken(user._id, user.role)

  res.json({
    success: true,
    message: 'Login successful!',
    token,
    user: user.toSafeObject(),
  })
})

// ── POST /api/auth/admin-register ──────────────────────────────
// Invite-code gated admin self-registration. If ADMIN_SIGNUP_CODE
// isn't configured on the server, this endpoint refuses every
// attempt — an unset server code must never match an empty or
// missing client code.
export const adminRegister = asyncHandler(async (req, res) => {
  const { fullName, password, inviteCode } = req.body
  const email = normalizeEmail(req.body.email)

  const serverCode = process.env.ADMIN_SIGNUP_CODE
  if (!serverCode || !serverCode.trim()) {
    throw new AppError('Admin registration is not available.', 403)
  }
  if (!inviteCode || inviteCode !== serverCode) {
    throw new AppError('Invalid invite code.', 403)
  }

  if (!email) throw new AppError('Email is required.', 400)

  const existing = await User.findOne({ email })
  if (existing) throw new AppError('Email already registered.', 409)

  const typoOf = findDomainTypo(email)
  if (typoOf) {
    throw new AppError(`Did you mean ${email.split('@')[0]}@${typoOf}? Please check your email address.`, 400)
  }

  if (!(await domainAcceptsMail(email))) {
    throw new AppError("We couldn't verify that email's domain. Please check for typos.", 400)
  }

  const user = await User.create({
    fullName,
    email,
    password,
    role: 'admin',
  })

  const token = generateToken(user._id, user.role)

  res.status(201).json({
    success: true,
    message: 'Admin account created successfully!',
    token,
    user: user.toSafeObject(),
  })
})

// ── POST /api/auth/forgot-password ─────────────────────────────
// Always responds with the same generic message whether or not the
// email is registered — same "identical response regardless of
// cause" convention login/adminLogin use, so this can't be used to
// check which emails have an account.
export const forgotPassword = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email)
  if (!email) throw new AppError('Email is required.', 400)

  const user = await User.findOne({ email })

  if (user) {
    const rawToken = crypto.randomBytes(32).toString('hex')
    user.passwordResetToken   = crypto.createHash('sha256').update(rawToken).digest('hex')
    user.passwordResetExpires = Date.now() + 30 * 60 * 1000 // 30 minutes
    await user.save({ validateBeforeSave: false })

    const resetUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset-password?token=${rawToken}`
    try {
      await sendPasswordResetEmail(user.email, resetUrl)
    } catch (err) {
      // Never let an SMTP failure surface to the client — besides being
      // a bad experience, it would only ever happen for a REGISTERED
      // email (unregistered ones skip sendMail entirely and reach the
      // generic response below instantly), which quietly defeats the
      // whole "identical response regardless of cause" point of this
      // endpoint. Logged here instead, since this is the only place
      // that can see it — check these logs if resets aren't arriving.
      console.error('[forgotPassword] Failed to send reset email:', err.message)
    }
  }

  res.json({
    success: true,
    message: "If that email is registered, we've sent a reset link.",
  })
})

// ── POST /api/auth/reset-password ──────────────────────────────
export const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body
  if (typeof token !== 'string' || typeof newPassword !== 'string' || !token || !newPassword) {
    throw new AppError('Token and new password are required.', 400)
  }
  if (newPassword.length < 6) {
    throw new AppError('Password must be at least 6 characters', 400)
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex')

  const user = await User.findOne({
    passwordResetToken:   hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  }).select('+password +passwordResetToken +passwordResetExpires')

  if (!user) throw new AppError('This reset link is invalid or has expired.', 400)

  user.password             = newPassword // re-hashed by the pre('save') hook
  user.passwordResetToken   = undefined
  user.passwordResetExpires = undefined
  await user.save()

  res.json({
    success: true,
    message: 'Password reset successfully — you can now log in.',
  })
})

// ── POST /api/auth/teacher-login ───────────────────────────────
// Mirrors adminLogin — same "never reveal which case it was" guard.
export const teacherLogin = asyncHandler(async (req, res) => {
  const { password } = req.body
  const email = normalizeEmail(req.body.email)

  if (!email || !password) {
    throw new AppError('Email and password are required.', 400)
  }

  const user    = await User.findOne({ email }).select('+password')
  const isMatch = user ? await user.comparePassword(password) : false

  if (!user || !isMatch || user.role !== 'teacher') {
    throw new AppError('Invalid email or password. Please try again.', 401)
  }

  user.lastActive = new Date()
  await user.save({ validateBeforeSave: false })

  const token = generateToken(user._id, user.role)

  res.json({
    success: true,
    message: 'Login successful!',
    token,
    user: user.toSafeObject(),
  })
})

// ── POST /api/auth/teacher-register ────────────────────────────
// Open teacher self-registration — no invite code required.
// Subjects and school level (examType) are chosen after sign-up, on
// /teacher/onboarding, not here — `subjects` starts empty and is what
// createClass checks against so a teacher can only run classes in a
// subject they've declared, via PUT /api/settings/profile.
export const teacherRegister = asyncHandler(async (req, res) => {
  const { fullName, password } = req.body
  const email = normalizeEmail(req.body.email)
  if (!email) throw new AppError('Email is required.', 400)

  const existing = await User.findOne({ email })
  if (existing) throw new AppError('Email already registered.', 409)

  const typoOf = findDomainTypo(email)
  if (typoOf) {
    throw new AppError(`Did you mean ${email.split('@')[0]}@${typoOf}? Please check your email address.`, 400)
  }

  if (!(await domainAcceptsMail(email))) {
    throw new AppError("We couldn't verify that email's domain. Please check for typos.", 400)
  }

  const user = await User.create({
    fullName,
    email,
    password,
    role: 'teacher',
  })

  const token = generateToken(user._id, user.role)

  res.status(201).json({
    success: true,
    message: 'Teacher account created successfully!',
    token,
    user: user.toSafeObject(),
  })
})