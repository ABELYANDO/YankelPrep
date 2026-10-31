import { useState, useEffect }  from 'react'
import { useSearchParams }       from 'react-router-dom'
import { useAuth }               from '../../context/AuthContext'
import { useNotifications }      from '../../context/NotificationContext'
import { useTheme }              from '../../context/ThemeContext'
import { settingsAPI }           from '../../api/settings.api'
import AppShell                  from '../../components/layout/AppShell'
import BadgeCard                 from '../../components/BadgeCard'
import {
  User, Lock, Award,
  Save, Flame, Target, BarChart2,
  CheckCircle2, AlertCircle,
  Sun, Moon, Monitor,
} from 'lucide-react'
import toast from 'react-hot-toast'

// ── Settings tabs ──────────────────────────────────────────────
// Subjects and Classes moved to the Dashboard so they're immediately
// visible/accessible without navigating into Settings — see
// DashboardPage.jsx's "Your Subjects"/"Your Classes" sections.
const TABS = [
  { id: 'profile',    label: 'Profile',    icon: User  },
  { id: 'password',   label: 'Password',   icon: Lock  },
  { id: 'badges',     label: 'Badges',     icon: Award },
  { id: 'appearance', label: 'Appearance', icon: Sun },
]

export default function SettingsPage() {
  const { user, updateUser } = useAuth()
  const { addBadgeNotifications } = useNotifications()
  const { theme, setTheme } = useTheme()

  // Deep-link support (e.g. a badge notification linking to
  // /settings?tab=badges) — falls back to Profile for anything invalid.
  const [searchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const [tab, setTab] = useState(
    TABS.some(t => t.id === requestedTab) ? requestedTab : 'profile'
  )
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)

  // ── Profile form state (examType/subjects are edited on the
  // Dashboard now, not here — kept as pass-through state so saving
  // the Profile tab doesn't clobber them) ─────────────────────
  const [fullName,  setFullName]  = useState('')
  const [school,    setSchool]    = useState('')
  const [examType,  setExamType]  = useState('WASSCE')
  const [subjects,  setSubjects]  = useState([])

  // ── Password form state ────────────────────────────────────
  const [currentPw, setCurrentPw] = useState('')
  const [newPw,     setNewPw]     = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwError,   setPwError]   = useState('')

  // ── Email form state ───────────────────────────────────────
  const [email,     setEmail]     = useState('')
  const [emailPw,   setEmailPw]   = useState('')
  const emailChanged = profile && email.trim().toLowerCase() !== (profile.email || '')

  // ── Load profile ───────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const data = await settingsAPI.getProfile()
        const p    = data.profile
        setProfile(p)
        setFullName(p.fullName || '')
        setEmail(p.email       || '')
        setSchool(p.school    || '')
        setExamType(p.examType || 'WASSCE')
        setSubjects(p.subjects || [])
      } catch (err) {
        toast.error(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ── Save profile ───────────────────────────────────────────
  const handleSaveProfile = async () => {
    if (!fullName.trim()) return toast.error('Name cannot be empty')
    setSaving(true)
    try {
      const data = await settingsAPI.updateProfile({ fullName, school, examType, subjects })
      updateUser({ fullName, school, examType, subjects })
      setProfile(prev => ({ ...prev, fullName, school, examType, subjects }))
      toast.success('Profile updated!')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Change email ───────────────────────────────────────────
  const handleChangeEmail = async () => {
    if (!email.trim()) return toast.error('Email cannot be empty')
    if (!emailPw) return toast.error('Enter your current password to change your email')
    setSaving(true)
    try {
      const data = await settingsAPI.changeEmail({ newEmail: email, currentPassword: emailPw })
      updateUser({ email: data.email })
      setProfile(prev => ({ ...prev, email: data.email }))
      setEmail(data.email)
      setEmailPw('')
      toast.success('Email updated!')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Change password ────────────────────────────────────────
  const handleChangePassword = async () => {
    setPwError('')
    if (!currentPw || !newPw || !confirmPw) {
      return setPwError('All fields are required')
    }
    if (newPw.length < 6) {
      return setPwError('New password must be at least 6 characters')
    }
    if (newPw !== confirmPw) {
      return setPwError('New passwords do not match')
    }

    setSaving(true)
    try {
      await settingsAPI.changePassword({
        currentPassword: currentPw,
        newPassword:     newPw,
      })
      toast.success('Password changed successfully!')
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch (err) {
      setPwError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Check for new badges ───────────────────────────────────
  const handleCheckBadges = async () => {
    try {
      const data = await settingsAPI.checkBadges()
      if (data.newBadges?.length > 0) {
        toast.success(data.message)
        addBadgeNotifications(data.newBadges)
        // Reload profile to show new badges
        const profileData = await settingsAPI.getProfile()
        setProfile(profileData.profile)
      } else {
        toast(data.message, { icon: <Award className="w-4 h-4 text-amber-500" /> })
      }
    } catch (err) {
      toast.error(err.message)
    }
  }

  if (loading) return (
    <AppShell title="Settings" subtitle="Account & preferences">
      <div className="flex items-center justify-center py-20">
        <div className="w-10 h-10 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    </AppShell>
  )

  return (
    <AppShell title="Settings" subtitle="Manage your account and preferences">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* ── Profile summary card ──────────────────────────── */}
        <div className="card flex items-center gap-5">

          {/* Avatar */}
          <div className="w-16 h-16 rounded-2xl bg-teal-600 flex items-center justify-center flex-shrink-0">
            <span
              className="text-2xl font-bold text-white"
              style={{ fontFamily: 'var(--font-heading)' }}
            >
              {profile?.fullName?.charAt(0)?.toUpperCase() || 'U'}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <h2
              className="text-lg font-bold text-slate-900 truncate"
              style={{ fontFamily: 'var(--font-heading)' }}
            >
              {profile?.fullName}
            </h2>
            <p className="text-sm text-slate-500">{profile?.email}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {profile?.school || 'No school set'} · {profile?.examType}
            </p>
          </div>

          {/* Quick stats */}
          <div className="hidden sm:flex gap-6 flex-shrink-0">
            {[
              { icon: Target, value: profile?.totalQuestionsAnswered || 0, label: 'Questions' },
              { icon: BarChart2, value: `${profile?.accuracy || 0}%`,     label: 'Accuracy'  },
              { icon: Flame, value: `${profile?.streak || 0}d`,           label: 'Streak'    },
            ].map(({ icon: Icon, value, label }) => (
              <div key={label} className="text-center">
                <Icon className="w-4 h-4 text-teal-500 mx-auto mb-1" />
                <p className="text-sm font-bold text-slate-800">{value}</p>
                <p className="text-xs text-slate-400">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Tabs ─────────────────────────────────────────── */}
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={tab === id ? { backgroundColor: 'var(--color-surface)' } : undefined}
              className={`
                flex-1 flex items-center justify-center gap-2
                py-2.5 px-3 rounded-lg text-sm font-medium transition-all duration-200
                ${tab === id
                  ? 'text-teal-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
                }
              `}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* ══════════════ PROFILE TAB ════════════════════════ */}
        {tab === 'profile' && (
          <div className="card space-y-5 animate-fade-in">
            <h3 className="section-title flex items-center gap-2">
              <User className="w-4 h-4 text-teal-600" />
              Personal information
            </h3>

            <div>
              <label className="label">Full name</label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Your full name"
                className="input"
              />
            </div>

            <div>
              <label className="label">Email address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="input"
              />
              {emailChanged && (
                <div className="mt-3 space-y-3">
                  <input
                    type="password"
                    value={emailPw}
                    onChange={e => setEmailPw(e.target.value)}
                    placeholder="Current password, to confirm the change"
                    className="input"
                  />
                  <button
                    onClick={handleChangeEmail}
                    disabled={saving}
                    className="btn-secondary w-full py-2.5"
                  >
                    Update email
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="label">
                School <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={school}
                onChange={e => setSchool(e.target.value)}
                placeholder="e.g. Achimota Senior High School"
                className="input"
              />
            </div>

            <button
              onClick={handleSaveProfile}
              disabled={saving}
              className="btn-primary w-full py-3"
            >
              {saving
                ? <><span className="spinner border-white/40 border-t-white" /> Saving…</>
                : <><Save className="w-4 h-4" /> Save profile</>
              }
            </button>
          </div>
        )}

        {/* ══════════════ PASSWORD TAB ═══════════════════════ */}
        {tab === 'password' && (
          <div className="card space-y-5 animate-fade-in">
            <h3 className="section-title flex items-center gap-2">
              <Lock className="w-4 h-4 text-teal-600" />
              Change password
            </h3>

            {pwError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {pwError}
              </div>
            )}

            <div>
              <label className="label">Current password</label>
              <input
                type="password"
                value={currentPw}
                onChange={e => { setPwError(''); setCurrentPw(e.target.value) }}
                placeholder="Your current password"
                className="input"
              />
            </div>

            <div>
              <label className="label">New password</label>
              <input
                type="password"
                value={newPw}
                onChange={e => { setPwError(''); setNewPw(e.target.value) }}
                placeholder="At least 6 characters"
                className="input"
              />
            </div>

            <div>
              <label className="label">Confirm new password</label>
              <input
                type="password"
                value={confirmPw}
                onChange={e => { setPwError(''); setConfirmPw(e.target.value) }}
                placeholder="Repeat your new password"
                className="input"
              />
            </div>

            {/* Password strength hint */}
            {newPw.length > 0 && (
              <div className="space-y-1.5">
                {[
                  { label: 'At least 6 characters',    pass: newPw.length >= 6     },
                  { label: 'Contains a number',         pass: /\d/.test(newPw)      },
                  { label: 'Matches confirmation',       pass: newPw === confirmPw && confirmPw.length > 0 },
                ].map(({ label, pass }) => (
                  <div key={label} className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className={`w-3.5 h-3.5 ${pass ? 'text-green-500' : 'text-slate-300'}`} />
                    <span className={pass ? 'text-green-700' : 'text-slate-400'}>{label}</span>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={handleChangePassword}
              disabled={saving}
              className="btn-primary w-full py-3"
            >
              {saving
                ? <><span className="spinner border-white/40 border-t-white" /> Changing…</>
                : <><Lock className="w-4 h-4" /> Change password</>
              }
            </button>
          </div>
        )}

        {/* ══════════════ BADGES TAB ═════════════════════════ */}
        {tab === 'badges' && (
          <div className="space-y-5 animate-fade-in">

            {/* Badge overview */}
            <div className="card flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                <Award className="w-6 h-6 text-amber-600" />
              </div>
              <div className="flex-1">
                <p
                  className="font-bold text-slate-900"
                  style={{ fontFamily: 'var(--font-heading)' }}
                >
                  {profile?.badgesEarned?.length || 0} of {profile?.totalBadges || 0} badges earned
                </p>
                <div className="w-full progress-bar mt-2">
                  <div
                    className="progress-fill bg-amber-500"
                    style={{
                      width: `${profile?.totalBadges > 0
                        ? Math.round(((profile?.badgesEarned?.length || 0) / profile.totalBadges) * 100)
                        : 0}%`
                    }}
                  />
                </div>
              </div>
              <button onClick={handleCheckBadges} className="btn-secondary text-sm flex-shrink-0">
                Check now
              </button>
            </div>

            {/* Earned badges */}
            {profile?.badgesEarned?.length > 0 && (
              <div className="card">
                <h3 className="section-title flex items-center gap-2">
                  <Award className="w-4 h-4 text-amber-500" />
                  Earned badges
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {profile.badgesEarned.map(badge => (
                    <BadgeCard
                      key={badge.id}
                      badge={badge}
                      size="md"
                      showDescription
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Locked badges */}
            {profile?.badgesLocked?.length > 0 && (
              <div className="card">
                <h3 className="section-title text-slate-500">
                  Locked badges — {profile.badgesLocked.length} remaining
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {profile.badgesLocked.map(badge => (
                    <BadgeCard
                      key={badge.id}
                      badge={badge}
                      size="md"
                      showDescription
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {(!profile?.badgesEarned || profile.badgesEarned.length === 0) && (
              <div className="card text-center py-12">
                <Award className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                <p className="font-medium text-slate-500">No badges yet</p>
                <p className="text-sm text-slate-400 mt-1">
                  Complete practice sessions and mock exams to earn your first badge
                </p>
              </div>
            )}
          </div>
        )}

        {/* ══════════════ APPEARANCE TAB ═════════════════════ */}
        {tab === 'appearance' && (
          <div className="card space-y-5 animate-fade-in">
            <h3 className="section-title flex items-center gap-2">
              <Sun className="w-4 h-4 text-teal-600" />
              Theme
            </h3>
            <p className="text-sm text-slate-500 -mt-3">
              Choose how YankelPrep looks. "System" follows your device's own light/dark setting automatically.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { value: 'light',  label: 'Light',  icon: Sun,     desc: 'Always light' },
                { value: 'dark',   label: 'Dark',    icon: Moon,    desc: 'Always dark' },
                { value: 'system', label: 'System',  icon: Monitor, desc: 'Match device' },
              ].map(({ value, label, icon: Icon, desc }) => {
                const isSelected = value === 'system'
                  ? false // "System" is an action (re-sync to OS), not a persisted state we track separately
                  : theme === value
                return (
                  <button
                    key={value}
                    onClick={() => {
                      if (value === 'system') {
                        const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
                        setTheme(prefersDark ? 'dark' : 'light')
                        try { localStorage.removeItem('eduprepai_theme_explicit') } catch { /* ignore */ }
                      } else {
                        setTheme(value)
                      }
                    }}
                    className={`flex flex-col items-center gap-2 py-5 rounded-xl border-2 text-sm font-medium transition-all ${
                      isSelected
                        ? 'bg-teal-50 border-teal-400 text-teal-800'
                        : 'border-slate-200 text-slate-600 hover:border-teal-200'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    {label}
                    <span className="text-xs font-normal text-slate-400">{desc}</span>
                  </button>
                )
              })}
            </div>

            <p className="text-xs text-slate-400">
              Currently: <strong className="text-slate-600 capitalize">{theme}</strong> mode
            </p>
          </div>
        )}

      </div>
    </AppShell>
  )
}