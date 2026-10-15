import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Mail, Lock, ArrowRight, Eye, EyeOff, UserCircle, Check, Trophy, AlertTriangle, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'
import examHallBg from '../../assets/exam-hall-bg.jpg'
import logo from '../../assets/logo.jpg'
import ThemeToggle from '../../components/ThemeToggle'
import { useTheme } from '../../context/ThemeContext'

// One page for all three roles instead of three separate login pages
// (which is exactly what caused sessions to silently overwrite each
// other across tabs) — the dropdown just decides which auth endpoint
// and landing page to use.
const ROLES = {
  student: { login: 'login',        home: '/dashboard', label: 'Student' },
  teacher: { login: 'teacherLogin', home: '/teacher',    label: 'Teacher' },
  admin:   { login: 'adminLogin',   home: '/admin',      label: 'Admin'   },
}

export default function LoginPage() {
  const auth     = useAuth()
  const navigate = useNavigate()
  const { theme } = useTheme()
  // Same wash colour/opacity used everywhere else the background photo
  // appears, so it reads consistently across every page in the app.
  const washRGB = theme === 'dark' ? '11,11,15' : '238,243,250'

  const [role,    setRole]    = useState('student')
  const [form,    setForm]    = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [showPw,  setShowPw]  = useState(false)
  const errorRef = useRef(null)

  // The mobile browser's own "Save password?" prompt can pop up right
  // over this banner the moment the form is submitted, making it easy
  // to miss even though it's still on screen — a toast (separate,
  // top-of-screen, stays for a few seconds) backs it up, and scrolling
  // the inline banner into view handles it being pushed off-screen by
  // the on-screen keyboard closing.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error])

  const handleChange  = (e) => { setError(''); setForm({ ...form, [e.target.name]: e.target.value }) }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const { login: loginFnName, home } = ROLES[role]
      await auth[loginFnName](form)
      toast.success('Welcome back!')
      navigate(home)
    } catch (err) {
      setError(err.message)
      // Longer than the app's default 4s — the browser's own
      // "Save password?" prompt often competes for attention right
      // after a failed login, so this needs more time to be noticed.
      toast.error(err.message, { duration: 8000 })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex relative">
      {/* A real position:fixed element, not background-attachment:
         fixed — iOS Safari renders that CSS property incorrectly
         (stretches/shifts on scroll as the address bar hides). */}
      <div
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(${washRGB},0.85), rgba(${washRGB},0.85)), url(${examHallBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />

      {/* Pre-login pages have no shell/TopBar of their own, so without
         this the theme is stuck following whatever the device's system
         setting happens to be, with no way to switch it manually. */}
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle className="text-slate-500 hover:bg-slate-100 hover:text-slate-700" />
      </div>

      {/* ── Left branding panel — desktop only ───────────── */}
      {/* Photo sits behind the dark gradient here, not the form side —
         this panel has no text inputs to keep readable, so the image can
         be shown much more visibly than the app's usual subtle texture. */}
      <div
        className="hidden lg:flex flex-col justify-between w-[420px] flex-shrink-0 p-10"
        style={{
          backgroundImage: `linear-gradient(160deg, rgba(194,65,12,0.82) 0%, rgba(124,45,18,0.85) 60%, rgba(49,17,7,0.9) 100%), url(${examHallBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-16 h-16 rounded-xl bg-white flex items-center justify-center overflow-hidden flex-shrink-0">
            <img src={logo} alt="YankelPrep" className="w-full h-full object-cover" />
          </div>
          <div>
            <span
              className="text-white font-semibold text-lg block"
              style={{ fontFamily: 'var(--font-heading)' }}
            >
              YankelPrep
            </span>
            <p className="text-teal-200/70 text-xs">Your Smart Path to Exam Success</p>
          </div>
        </div>

        {/* Hero copy */}
        <div className="space-y-5">
          <div>
            <h1
              className="text-3xl font-bold text-white leading-tight"
              style={{ fontFamily: 'var(--font-heading)' }}
            >
              Smarter exam prep,<br />powered by AI.
            </h1>
            <p className="text-teal-200/80 mt-3 text-sm leading-relaxed">
              10 years of past WASSCE and BECE data, analysed by AI to predict
              what topics appear in your next exam.
            </p>
          </div>

          {/* Feature list */}
          <div className="space-y-3">
            {[
              'AI-powered topic predictions with confidence scores',
              'Adaptive difficulty that matches your level',
              'WAEC-standard mock exams with marking schemes',
              'Detailed PDF reports with examiner feedback',
            ].map(feat => (
              <div key={feat} className="flex items-start gap-2.5">
                <div className="w-4 h-4 rounded-full bg-teal-400/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check className="w-2.5 h-2.5 text-teal-300" />
                </div>
                <p className="text-teal-100/70 text-xs leading-relaxed">{feat}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom badge */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/6 border border-white/10">
          <div className="w-8 h-8 rounded-lg bg-amber-400/20 flex items-center justify-center">
            <Trophy className="w-4 h-4 text-amber-300" />
          </div>
          <div>
            <p className="text-white text-xs font-medium">Designed for Ghana</p>
            <p className="text-teal-300/70 text-xs">WASSCE · BECE · All subjects</p>
          </div>
        </div>
      </div>

      {/* ── Right form panel ──────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-5 lg:p-10">
        <div className="w-full max-w-md animate-fade-in">

          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0">
              <img src={logo} alt="YankelPrep" className="w-full h-full object-cover" />
            </div>
            <div>
              <span
                className="font-semibold text-teal-800 block"
                style={{ fontFamily: 'var(--font-heading)' }}
              >
                YankelPrep
              </span>
              <p className="text-slate-400 text-xs">Your Smart Path to Exam Success</p>
            </div>
          </div>

          <div className="mb-8">
            <h2
              className="text-2xl font-bold text-slate-900"
              style={{ fontFamily: 'var(--font-heading)' }}
            >
              Sign in to your account
            </h2>
            <p className="text-slate-500 text-sm mt-1">
              Welcome back — let's continue preparing.
            </p>
          </div>

          {/* Error banner */}
          {error && (
            <div
              ref={errorRef}
              className="flex items-start gap-2.5 bg-red-50 border-2 border-red-300 text-red-700 rounded-xl px-4 py-3 mb-5 text-sm font-medium animate-fade-in"
            >
              <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Role */}
            <div>
              <label className="label">Signing in as</label>
              <div className="relative">
                {/* iOS Safari ignores padding-left on a native <select>'s
                   own text, so the icon and the option label can render
                   on top of each other — appearance-none opts out of the
                   native chrome entirely (and its own dropdown arrow) so
                   normal box-model padding applies, then ChevronDown
                   stands in for the arrow that appearance-none removed. */}
                <UserCircle className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none z-10" />
                <select
                  value={role}
                  onChange={e => { setError(''); setRole(e.target.value) }}
                  className="input pl-10 pr-10 appearance-none"
                >
                  {Object.entries(ROLES).map(([key, { label }]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="label">Email address</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="email" name="email" value={form.email}
                  onChange={handleChange} required
                  placeholder="you@example.com"
                  className="input pl-10"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="label">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type={showPw ? 'text' : 'password'}
                  name="password" value={form.password}
                  onChange={handleChange} required
                  placeholder="Your password"
                  className="input pl-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(p => !p)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="flex justify-end mt-1.5">
                <Link to="/forgot-password" className="text-xs text-teal-600 hover:text-teal-700 transition-colors">
                  Forgot password?
                </Link>
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base">
              {loading
                ? <><span className="spinner border-white/40 border-t-white" /> Signing in…</>
                : <>Sign in <ArrowRight className="w-4 h-4" /></>
              }
            </button>
          </form>

          <p className="text-center text-sm text-slate-500 mt-6">
            Don't have an account?{' '}
            <Link
              to={role === 'admin' ? '/admin/register' : '/register'}
              className="text-teal-600 font-medium hover:text-teal-700 transition-colors"
            >
              {role === 'admin' ? 'Enter an admin invite code' : 'Create one free'}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}