import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const userSchema = new mongoose.Schema(
  {
    // ── Personal info ──────────────────────────────────────────
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
    },

    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,           // no duplicate accounts
      lowercase: true,
      trim: true,
      match: [/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Please enter a valid email'],
    },

    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,          // NEVER returned in queries by default
    },

    school: {
      type: String,
      trim: true,
      default: '',
    },

    examType: {
      type: String,
      enum: ['WASSCE', 'BECE'],
      default: 'WASSCE',
    },

    subjects: {
      type: [String],         // e.g. ['Mathematics', 'English Language']
      default: [],
    },

    role: {
      type: String,
      enum: ['student', 'admin', 'teacher'],
      default: 'student',
    },

    // ── Gamification ───────────────────────────────────────────
    streak: {
      type: Number,
      default: 0,
    },

    badges: {
      type: [String],
      default: [],
    },

    totalQuestionsAnswered: {
      type: Number,
      default: 0,
    },

    totalCorrect: {
      type: Number,
      default: 0,
    },

    lastActive: {
      type: Date,
      default: Date.now,
    },

    // Separate from lastActive on purpose — lastActive is touched by
    // every answer submission and login (a general "last seen" signal),
    // which would mask same-day activity if the streak logic read it
    // too. Only updateStreak() reads/writes this field, so it reflects
    // the last calendar day the streak was actually credited.
    lastStreakDate: {
      type: Date,
      default: null,
    },

    // ── Password reset ──────────────────────────────────────────
    // Only a SHA-256 hash of the reset token is ever stored here (the
    // raw token only exists in the emailed link) — same "never store
    // the usable secret" convention as `password` above, hence the
    // matching select: false.
    passwordResetToken: {
      type: String,
      select: false,
    },

    passwordResetExpires: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true,         // adds createdAt and updatedAt automatically
  }
)

// ── Hash password before saving ────────────────────────────────
// This runs automatically every time a user is saved.
// We only re-hash if the password field was actually changed.
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, 12)
  next()
})

// ── Method: compare entered password with stored hash ──────────
// Called during login: user.comparePassword('what they typed')
userSchema.methods.comparePassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password)
}

// ── Method: safe user object (no password) ─────────────────────
// Use this whenever sending user data to the client
userSchema.methods.toSafeObject = function () {
  return {
    id:                    this._id,
    fullName:              this.fullName,
    email:                 this.email,
    school:                this.school,
    examType:              this.examType,
    subjects:              this.subjects,
    role:                  this.role,
    streak:                this.streak,
    badges:                this.badges,
    totalQuestionsAnswered: this.totalQuestionsAnswered,
    totalCorrect:          this.totalCorrect,
    lastActive:            this.lastActive,
    createdAt:             this.createdAt,
  }
}

const User = mongoose.model('User', userSchema)
export default User