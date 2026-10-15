import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { GraduationCap, User, Mail, Lock, School, ArrowRight, Eye, EyeOff, Users, AlertTriangle } from 'lucide-react'
import logo from '../../assets/logo.jpg'
import toast from 'react-hot-toast'
import ThemeToggle from '../../components/ThemeToggle'

// Same pattern the server validates against (User.model.js) — checked
// here too so a malformed email is caught instantly, not after a round
// trip to the server.
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/

export default function RegisterPage() {
  const { register, teacherRegister } = useAuth()
  const navigate      = useNavigate()

  // Student is a single short form below — exam type/subjects are chosen
  // post-signup on the /onboarding page instead. Teacher swaps in its own
  // single short form (see the accountType === 'teacher' branch), with
  // school level + subjects chosen post-signup on /teacher/onboarding the
  // same way — folded into this one page, along with the old
  // /teacher/register, so there's a single entry point instead of two
  // separate pages. Admin account creation stays on its own separate
  // /admin/register page, deliberately not merged here.
  const [accountType, setAccountType] = useState('student')

  const [form, setForm] = useState({
    fullName: '', email: '', password: '', confirmPassword: '', school: '',
  })
  const [teacherForm, setTeacherForm] = useState({ fullName: '', email: '', password: '', confirmPassword: '' })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [showPw,        setShowPw]        = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [showTeacherPw,        setShowTeacherPw]        = useState(false)
  const [showTeacherConfirmPw, setShowTeacherConfirmPw] = useState(false)

  const handleTeacherChange = (e) => {
    setError('')
    setTeacherForm(p => ({ ...p, [e.target.name]: e.target.value }))
  }

  const handleTeacherSubmit = async (e) => {
    e.preventDefault()
    if (!EMAIL_PATTERN.test(teacherForm.email)) {
      return setError('Please enter a valid email address')
    }
    if (teacherForm.password.length < 6) {
      return setError('Password must be at least 6 characters')
    }
    if (teacherForm.password !== teacherForm.confirmPassword) {
      return setError('Passwords do not match')
    }
    setLoading(true); setError('')
    try {
      const { confirmPassword, ...payload } = teacherForm
      await teacherRegister(payload)
      toast.success('Teacher account created!')
      navigate('/teacher/onboarding')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    setError('')
    setForm(p => ({ ...p, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.fullName || !form.email || !form.password || !form.confirmPassword) {
      return setError('Please fill in all required fields')
    }
    if (!EMAIL_PATTERN.test(form.email)) {
      return setError('Please enter a valid email address')
    }
    if (form.password.length < 6) {
      return setError('Password must be at least 6 characters')
    }
    if (form.password !== form.confirmPassword) {
      return setError('Passwords do not match')
    }
    setLoading(true); setError('')
    try {
      const { confirmPassword, ...payload } = form
      await register(payload)
      toast.success('Welcome to YankelPrep!')
      navigate('/onboarding')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-5 relative"
      style={{ background: 'var(--color-bg)' }}
    >
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle className="text-slate-500 hover:bg-slate-100 hover:text-slate-700" />
      </div>

      <div className="w-full max-w-lg animate-fade-in">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white shadow-sm overflow-hidden mb-4">
            <img src={logo} alt="YankelPrep" className="w-full h-full object-cover" />
          </div>
          <h1
            className="text-2xl font-bold text-slate-900"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            Create your free account
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Join thousands of students preparing smarter
          </p>
        </div>

        {/* Account type toggle */}
        <div className="flex gap-2 mb-6 bg-slate-100 rounded-xl p-1">
          {[
            { key: 'student', label: 'Student', icon: GraduationCap },
            { key: 'teacher', label: 'Teacher', icon: Users },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => { setError(''); setAccountType(key) }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                accountType === key ? 'bg-surface text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        {/* ══════════════ TEACHER FORM (single step) ═══════════ */}
        {accountType === 'teacher' && (
          <div className="card shadow-md">
            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 mb-5 text-sm">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
              </div>
            )}
            <form onSubmit={handleTeacherSubmit} className="space-y-4">
              <div>
                <label className="label">Full name</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text" name="fullName" value={teacherForm.fullName}
                    onChange={handleTeacherChange} required placeholder="e.g. Ama Boateng"
                    className="input pl-10"
                  />
                </div>
              </div>
              <div>
                <label className="label">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email" name="email" value={teacherForm.email}
                    onChange={handleTeacherChange} required placeholder="teacher@example.com"
                    className="input pl-10"
                  />
                </div>
              </div>
              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type={showTeacherPw ? 'text' : 'password'}
                    name="password" value={teacherForm.password}
                    onChange={handleTeacherChange} required placeholder="At least 6 characters"
                    className="input pl-10 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTeacherPw(p => !p)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    aria-label={showTeacherPw ? 'Hide password' : 'Show password'}
                  >
                    {showTeacherPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Confirm password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type={showTeacherConfirmPw ? 'text' : 'password'}
                    name="confirmPassword" value={teacherForm.confirmPassword}
                    onChange={handleTeacherChange} required placeholder="Re-enter your password"
                    className="input pl-10 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTeacherConfirmPw(p => !p)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    aria-label={showTeacherConfirmPw ? 'Hide password' : 'Show password'}
                  >
                    {showTeacherConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full py-3">
                {loading
                  ? <><span className="spinner border-white/40 border-t-white" /> Creating…</>
                  : <>Create teacher account <ArrowRight className="w-4 h-4" /></>
                }
              </button>
            </form>
          </div>
        )}

        {/* ══════════════ STUDENT FORM (single step) ═══════════ */}
        {accountType === 'student' && (
        <>
        <div className="card shadow-md">

          {/* Error banner */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 mb-5 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in">
              <div>
                <label className="label">Full name</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text" name="fullName" value={form.fullName}
                    onChange={handleChange} required placeholder="e.g. Kwame Mensah"
                    className="input pl-10"
                  />
                </div>
              </div>

              <div>
                <label className="label">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email" name="email" value={form.email}
                    onChange={handleChange} required placeholder="you@example.com"
                    className="input pl-10"
                  />
                </div>
              </div>

              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type={showPw ? 'text' : 'password'}
                    name="password" value={form.password}
                    onChange={handleChange} required placeholder="At least 6 characters"
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
              </div>

              <div>
                <label className="label">Confirm password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type={showConfirmPw ? 'text' : 'password'}
                    name="confirmPassword" value={form.confirmPassword}
                    onChange={handleChange} required placeholder="Re-enter your password"
                    className="input pl-10 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPw(p => !p)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    aria-label={showConfirmPw ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="label">
                  School <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <School className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text" name="school" value={form.school}
                    onChange={handleChange} placeholder="e.g. Achimota Senior High School"
                    className="input pl-10"
                  />
                </div>
              </div>

              <button type="submit" disabled={loading} className="btn-primary w-full py-3">
                {loading
                  ? <><span className="spinner border-white/40 border-t-white" /> Creating…</>
                  : <>Create account <ArrowRight className="w-4 h-4" /></>
                }
              </button>
          </form>
        </div>
        </>
        )}

        <p className="text-center text-sm text-slate-500 mt-5">
          Already have an account?{' '}
          <Link to="/login" className="text-teal-600 font-medium hover:text-teal-700 transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}