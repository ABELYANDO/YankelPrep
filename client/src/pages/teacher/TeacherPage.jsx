import { useState, useEffect } from 'react'
import TeacherShell          from '../../components/layout/TeacherShell'
import AIGeneratorPanel      from '../../components/admin/AIGeneratorPanel'
import PDFExtractorPanel     from '../../components/admin/PDFExtractorPanel'
import ManualQuestionForm    from '../../components/ManualQuestionForm'
import SubmissionReviewPanel from '../../components/teacher/SubmissionReviewPanel'
import MockExamReviewPanel   from '../../components/teacher/MockExamReviewPanel'
import { teacherAPI }       from '../../api/teacher.api'
import MasteryHeatmap        from '../../components/analytics/MasteryHeatmap'
import ScannedFilesViewer    from '../../components/ScannedFilesViewer'
import SubjectLevelPicker    from '../../components/teacher/SubjectLevelPicker'
import { useAuth } from '../../context/AuthContext'
import { settingsAPI } from '../../api/settings.api'
import {
  Users, Plus, Cpu, FileSearch, Type, Trash2,
  Copy, ClipboardList, ArrowRight, X, ClipboardCheck, Camera,
  AlertTriangle, Target, BookOpen, UserMinus, Pencil, UserPlus,
  BarChart2, Megaphone, Download, Flame, Clock, FileText, Eye,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { getSubjectsForExamType, GHANAIAN_LANGUAGES } from '../../constants/subjects'

const TABS = [
  { id: 'classes',      label: 'My Classes',    icon: Users },
  { id: 'assignment',   label: 'New Assignment', icon: ClipboardList },
  { id: 'review',       label: 'Review Submissions', icon: ClipboardCheck },
  { id: 'analytics',    label: 'Analytics',     icon: BarChart2 },
  { id: 'announcements', label: 'Announcements', icon: Megaphone },
  { id: 'subjects',     label: 'My Subjects',   icon: BookOpen },
]

export default function TeacherPage() {
  const { user, updateUser } = useAuth()
  const [tab, setTab] = useState('classes')

  // ── My Subjects (level + what I teach — editable any time) ─────
  const [myLevel,    setMyLevel]    = useState(user?.examType || 'WASSCE')
  const [mySubjects, setMySubjects] = useState(user?.subjects || [])
  const [savingSubjects, setSavingSubjects] = useState(false)

  const handleSaveSubjects = async () => {
    if (mySubjects.length === 0) return toast.error('Select at least one subject')
    setSavingSubjects(true)
    try {
      await settingsAPI.updateProfile({ examType: myLevel, subjects: mySubjects })
      updateUser({ examType: myLevel, subjects: mySubjects })
      toast.success('Subjects updated')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingSubjects(false)
    }
  }

  // ── Classes ──────────────────────────────────────────────────
  const [classes,       setClasses]       = useState([])
  const [classesLoading, setClassesLoading] = useState(false)
  const [newClass, setNewClass] = useState({ name: '', subject: 'Mathematics', examType: 'WASSCE' })
  const [creatingClass, setCreatingClass] = useState(false)
  const [expandedClassId, setExpandedClassId] = useState(null) // which class's roster is shown

  // ── Student insight panel (struggling topics, practice + mock) ─
  const [viewingStudent,        setViewingStudent]        = useState(null) // { id, fullName, classId, subject }
  const [studentMastery,        setStudentMastery]        = useState(null)
  const [studentMasteryLoading, setStudentMasteryLoading] = useState(false)

  // ── Assignments overview (per class, shown under Classes tab) ──
  const [assignments,        setAssignments]        = useState([])
  const [assignmentsLoading, setAssignmentsLoading]  = useState(false)
  // Which assignment's title/due-date edit form is open, and its draft
  // values — null when nothing is being edited.
  const [editingAssignmentId, setEditingAssignmentId] = useState(null)
  const [editForm, setEditForm] = useState({ title: '', dueDate: '', releaseDate: '' })
  const [savingAssignment,  setSavingAssignment]  = useState(false)
  const [assigningNewIds,   setAssigningNewIds]   = useState([]) // assignment _ids currently running assign-new-students
  const [openSubmissionsId, setOpenSubmissionsId] = useState(null) // assignment whose student list is shown
  const [assignmentSubs,    setAssignmentSubs]    = useState([])
  const [assignmentSubsLoading, setAssignmentSubsLoading] = useState(false)

  // ── Class analytics tab ─────────────────────────────────────
  const [analyticsClassId, setAnalyticsClassId] = useState('')
  const [analytics,        setAnalytics]        = useState(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [exportingClass,   setExportingClass]   = useState(false)

  // ── Announcements tab ────────────────────────────────────────
  const [announceClassId,     setAnnounceClassId]     = useState('')
  const [announcements,       setAnnouncements]       = useState([])
  const [announcementsLoading, setAnnouncementsLoading] = useState(false)
  const [newAnnouncement,     setNewAnnouncement]     = useState('')
  const [postingAnnouncement, setPostingAnnouncement] = useState(false)

  // ── New assignment builder ──────────────────────────────────
  const [selectedClassId, setSelectedClassId] = useState('')
  const [title,   setTitle]   = useState('')
  const [dueDate, setDueDate] = useState('')
  const [releaseDate, setReleaseDate] = useState('')
  const [draftQuestions, setDraftQuestions] = useState([])
  const [activeTool, setActiveTool] = useState(null) // 'ai' | 'pdf' | 'manual' | null
  const [creatingAssignment, setCreatingAssignment] = useState(false)
  // 'questions' builds from AI/PDF/manual questions as before; 'file'
  // sends one PDF handout for students to download, solve on paper and
  // send back — see attachmentFile/maxMarks below.
  const [assignmentFormat, setAssignmentFormat] = useState('questions')
  const [attachmentFile,   setAttachmentFile]   = useState(null) // { data, mimeType, filename }
  const [maxMarks,         setMaxMarks]         = useState(20)
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  // Set when jumping here from a student's insight panel — restricts
  // the assignment to just that student instead of the whole class.
  const [targetStudent, setTargetStudent] = useState(null) // { id, fullName } | null

  // ── Review queue — merges Assignment submissions and Mock Exams,
  // both reached the same way (a student photo-scanned an answer) ───
  const [pendingReviews,  setPendingReviews]  = useState([]) // [{ type: 'assignment'|'mockExam', id, ... }]
  const [reviewsLoading,  setReviewsLoading]  = useState(false)
  const [reviewing,       setReviewing]       = useState(null) // { type, id } currently open, or null for the list

  const selectedClass = classes.find(c => c._id === selectedClassId)

  useEffect(() => { loadClasses() }, [])
  useEffect(() => { if (tab === 'classes') loadAssignments() }, [tab])
  useEffect(() => { if (tab === 'review') loadPendingReviews() }, [tab])

  // Default the analytics/announcements class pickers to the teacher's
  // first class once classes have loaded, so the tab isn't empty on
  // first visit — switching classes re-fires the load below.
  useEffect(() => {
    if (tab === 'analytics' && classes.length > 0 && !analyticsClassId) setAnalyticsClassId(classes[0]._id)
  }, [tab, classes, analyticsClassId])
  useEffect(() => {
    if (tab === 'analytics' && analyticsClassId) loadAnalytics(analyticsClassId)
  }, [tab, analyticsClassId])

  useEffect(() => {
    if (tab === 'announcements' && classes.length > 0 && !announceClassId) setAnnounceClassId(classes[0]._id)
  }, [tab, classes, announceClassId])
  useEffect(() => {
    if (tab === 'announcements' && announceClassId) loadAnnouncements(announceClassId)
  }, [tab, announceClassId])

  const loadPendingReviews = async () => {
    setReviewsLoading(true)
    try {
      const [assignmentsData, mockExamsData] = await Promise.all([
        teacherAPI.getPendingReviews(),
        teacherAPI.getPendingMockExams(),
      ])
      const merged = [
        ...(assignmentsData.submissions || []).map(s => ({
          type: 'assignment', id: s.submissionId, title: s.title,
          studentName: s.studentName, subject: s.subject, submittedAt: s.submittedAt,
        })),
        ...(mockExamsData.mockExams || []).map(e => ({
          type: 'mockExam', id: e.examId, title: `${e.subject} Mock Exam`,
          studentName: e.studentName, subject: e.subject, submittedAt: e.submittedAt,
        })),
      ].sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt))
      setPendingReviews(merged)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setReviewsLoading(false)
    }
  }

  const toggleAssignmentSubmissions = async (assignmentId) => {
    if (openSubmissionsId === assignmentId) return setOpenSubmissionsId(null)
    setOpenSubmissionsId(assignmentId)
    setAssignmentSubs([])
    setAssignmentSubsLoading(true)
    try {
      const data = await teacherAPI.getAssignmentSubmissions(assignmentId)
      setAssignmentSubs(data.submissions || [])
    } catch (err) {
      toast.error(err.message)
    } finally {
      setAssignmentSubsLoading(false)
    }
  }

  // Opens one student's work in the Review tab; `from` lets its Back
  // button return to the assignments list instead of the review queue.
  const openSubmission = (submissionId) => {
    setReviewing({ type: 'assignment', id: submissionId, from: 'classes' })
    setOpenSubmissionsId(null) // statuses may change while it's open; reload on next expand
    setTab('review')
  }

  const loadClasses = async () => {
    setClassesLoading(true)
    try {
      const data = await teacherAPI.getClasses()
      setClasses(data.classes || [])
    } catch (err) {
      toast.error(err.message)
    } finally {
      setClassesLoading(false)
    }
  }

  const loadAssignments = async () => {
    setAssignmentsLoading(true)
    try {
      const data = await teacherAPI.getAssignments()
      setAssignments(data.assignments || [])
    } catch (err) {
      toast.error(err.message)
    } finally {
      setAssignmentsLoading(false)
    }
  }

  const handleCreateClass = async (e) => {
    e.preventDefault()
    setCreatingClass(true)
    try {
      const data = await teacherAPI.createClass(newClass)
      toast.success(`Class created — join code ${data.class.joinCode}`)
      setNewClass({ name: '', subject: 'Mathematics', examType: 'WASSCE' })
      loadClasses()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setCreatingClass(false)
    }
  }

  const copyCode = (code) => {
    navigator.clipboard?.writeText(code)
    toast.success('Join code copied')
  }

  const openStudentInsight = async (cls, student) => {
    setViewingStudent({ id: student._id, fullName: student.fullName, classId: cls._id, subject: cls.subject })
    setStudentMastery(null)
    setStudentMasteryLoading(true)
    try {
      const data = await teacherAPI.getStudentMastery(student._id, cls.subject)
      setStudentMastery(data)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setStudentMasteryLoading(false)
    }
  }

  const handleRemoveStudent = async (cls, student) => {
    if (!window.confirm(`Remove ${student.fullName} from ${cls.name}? They'll keep access to work already assigned, but won't receive anything new from this class.`)) return
    try {
      await teacherAPI.removeStudent(cls._id, student._id)
      toast.success(`${student.fullName} removed from ${cls.name}`)
      if (viewingStudent?.id === student._id) setViewingStudent(null)
      loadClasses()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleDeleteClass = async (cls) => {
    if (!window.confirm(`Delete "${cls.name}"? This also deletes its assignments and removes ${cls.studentCount > 0 ? `all ${cls.studentCount} student${cls.studentCount !== 1 ? 's' : ''} from it` : 'it'}. This cannot be undone.`)) return
    try {
      await teacherAPI.deleteClass(cls._id)
      toast.success(`${cls.name} deleted`)
      if (expandedClassId === cls._id) setExpandedClassId(null)
      if (selectedClassId === cls._id) setSelectedClassId('')
      if (viewingStudent?.classId === cls._id) setViewingStudent(null)
      loadClasses()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const startRemedialAssignment = () => {
    if (!viewingStudent) return
    setSelectedClassId(viewingStudent.classId)
    setTargetStudent({ id: viewingStudent.id, fullName: viewingStudent.fullName })
    setViewingStudent(null)
    setTab('assignment')
  }

  // Sub-tools each call this once their own QuestionPreviewTable/form
  // approval step runs — merges into the running draft rather than
  // saving anywhere yet. Nothing is persisted until "Create & assign".
  const addToDraft = (questions) => {
    setDraftQuestions(prev => [...prev, ...questions])
    setActiveTool(null)
    toast.success(`${questions.length} question${questions.length !== 1 ? 's' : ''} added to assignment draft`)
  }

  const removeFromDraft = (idx) => {
    setDraftQuestions(prev => prev.filter((_, i) => i !== idx))
  }

  const totalMarks = draftQuestions.reduce((sum, q) => sum + (Number(q.marks) || 0), 0)

  const handleAttachmentUpload = async (file) => {
    if (!file) return
    setUploadingAttachment(true)
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload  = () => resolve(reader.result.split(',')[1])
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsDataURL(file)
      })
      setAttachmentFile({ data, mimeType: file.type, filename: file.name })
    } catch (err) {
      toast.error(err.message || 'Could not read that file')
    } finally {
      setUploadingAttachment(false)
    }
  }

  const handleCreateAssignment = async () => {
    if (!selectedClassId) return toast.error('Select a class first')
    if (!title.trim())    return toast.error('Give the assignment a title')
    if (assignmentFormat === 'file') {
      if (!attachmentFile) return toast.error('Attach a PDF for students to solve')
      if (!maxMarks || Number(maxMarks) <= 0) return toast.error('Set how many marks this assignment is worth')
    } else if (draftQuestions.length === 0) {
      return toast.error('Add at least one question')
    }

    setCreatingAssignment(true)
    try {
      const data = await teacherAPI.createAssignment({
        classId: selectedClassId,
        title,
        dueDate: dueDate || null,
        releaseDate: releaseDate || null,
        format: assignmentFormat,
        ...(assignmentFormat === 'file'
          ? { attachmentFile, maxMarks: Number(maxMarks) }
          : { questions: draftQuestions }),
        studentIds: targetStudent ? [targetStudent.id] : undefined,
      })
      toast.success(data.message)
      setTitle('')
      setDueDate('')
      setReleaseDate('')
      setDraftQuestions([])
      setAttachmentFile(null)
      setMaxMarks(20)
      setAssignmentFormat('questions')
      setSelectedClassId('')
      setTargetStudent(null)
      setTab('classes')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setCreatingAssignment(false)
    }
  }

  // ── Edit / delete / backfill an existing assignment ────────────
  // Only title, due date and release date are editable — the question
  // set stays fixed once created (see updateAssignment's comment
  // server-side).
  const openEditAssignment = (a) => {
    setEditingAssignmentId(a._id)
    setEditForm({
      title: a.title,
      dueDate: a.dueDate ? a.dueDate.slice(0, 10) : '',
      releaseDate: a.releaseDate ? a.releaseDate.slice(0, 10) : '',
    })
  }

  const handleSaveAssignment = async (assignmentId) => {
    if (!editForm.title.trim()) return toast.error('Give the assignment a title')
    setSavingAssignment(true)
    try {
      await teacherAPI.updateAssignment(assignmentId, {
        title: editForm.title,
        dueDate: editForm.dueDate || null,
        releaseDate: editForm.releaseDate || null,
      })
      toast.success('Assignment updated')
      setEditingAssignmentId(null)
      loadAssignments()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingAssignment(false)
    }
  }

  const handleDeleteAssignment = async (a) => {
    if (!window.confirm(`Delete "${a.title}"? This removes it and every student's submission for it. This cannot be undone.`)) return
    try {
      await teacherAPI.deleteAssignment(a._id)
      toast.success(`${a.title} deleted`)
      loadAssignments()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleAssignToNewStudents = async (a) => {
    setAssigningNewIds(prev => [...prev, a._id])
    try {
      const data = await teacherAPI.assignToNewStudents(a._id)
      toast.success(data.message)
      if (data.count > 0) loadAssignments()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setAssigningNewIds(prev => prev.filter(id => id !== a._id))
    }
  }

  // ── Class analytics ─────────────────────────────────────────
  const loadAnalytics = async (classId) => {
    setAnalyticsLoading(true)
    try {
      const data = await teacherAPI.getClassAnalytics(classId)
      setAnalytics(data)
    } catch (err) {
      toast.error(err.message)
      setAnalytics(null)
    } finally {
      setAnalyticsLoading(false)
    }
  }

  const handleExportClass = async (classId, className) => {
    setExportingClass(true)
    try {
      const blob = await teacherAPI.exportClassResults(classId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${className.replace(/[^a-z0-9]/gi, '_')}_results.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setExportingClass(false)
    }
  }

  // ── Announcements ───────────────────────────────────────────
  const loadAnnouncements = async (classId) => {
    setAnnouncementsLoading(true)
    try {
      const data = await teacherAPI.getClassAnnouncements(classId)
      setAnnouncements(data.announcements || [])
    } catch (err) {
      toast.error(err.message)
    } finally {
      setAnnouncementsLoading(false)
    }
  }

  const handlePostAnnouncement = async () => {
    if (!newAnnouncement.trim()) return toast.error('Write something to post')
    setPostingAnnouncement(true)
    try {
      await teacherAPI.createAnnouncement(announceClassId, newAnnouncement.trim())
      toast.success('Posted to class')
      setNewAnnouncement('')
      loadAnnouncements(announceClassId)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setPostingAnnouncement(false)
    }
  }

  const handleDeleteAnnouncement = async (ann) => {
    if (!window.confirm('Delete this announcement?')) return
    try {
      await teacherAPI.deleteAnnouncement(ann._id)
      setAnnouncements(prev => prev.filter(a => a._id !== ann._id))
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <TeacherShell>
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-semibold text-slate-800" style={{ fontFamily: 'var(--font-heading)' }}>
              Classes & Assignments
            </p>
            <p className="text-xs text-slate-500">Set remedial work targeted at your students' gaps</p>
          </div>
        </div>

        {/* Tab bar — min-w-0 lets these shrink below their label's natural
           width; without it, flex items refuse to shrink past their
           content size, so 4 tabs (one as long as "Review Submissions")
           force the whole row (and page) wider than a narrow phone
           screen. Labels hide below sm, leaving icon-only tabs, same
           convention as TeacherShell's Sign out button. */}
        <div className="flex gap-1 bg-slate-100/80 rounded-xl p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2.5 px-2 sm:px-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                tab === id ? 'bg-surface text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="hidden sm:inline truncate">{label}</span>
            </button>
          ))}
        </div>

        {/* ── My Classes tab ─────────────────────────────────── */}
        {tab === 'classes' && (
          <div className="space-y-5 animate-fade-in">

            {/* Create a class */}
            <div className="card">
              <h3 className="section-title flex items-center gap-2">
                <Plus className="w-4 h-4 text-blue-600" /> Create a class
              </h3>
              <form onSubmit={handleCreateClass} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                <div className="sm:col-span-2">
                  <label className="label">Class name</label>
                  <input
                    type="text" value={newClass.name}
                    onChange={e => setNewClass(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Form 2 Remedial Maths" className="input" required
                  />
                </div>
                <div>
                  <label className="label">Subject</label>
                  <select
                    value={newClass.subject}
                    onChange={e => setNewClass(p => ({ ...p, subject: e.target.value }))}
                    className="input"
                  >
                    {getSubjectsForExamType(newClass.examType)
                      .filter(s => !GHANAIAN_LANGUAGES.includes(s))
                      .map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Exam type</label>
                  <select
                    value={newClass.examType}
                    onChange={e => {
                      const examType = e.target.value
                      const subjects = getSubjectsForExamType(examType)
                      setNewClass(p => ({ ...p, examType, subject: subjects.includes(p.subject) ? p.subject : subjects[0] }))
                    }}
                    className="input"
                  >
                    <option>WASSCE</option>
                    <option>BECE</option>
                  </select>
                </div>
                <div className="sm:col-span-4">
                  <button type="submit" disabled={creatingClass} className="btn-primary py-2.5">
                    {creatingClass ? <span className="spinner border-white/40 border-t-white" /> : <Plus className="w-4 h-4" />}
                    Create class
                  </button>
                </div>
              </form>
            </div>

            {/* Class list */}
            <div className="space-y-3">
              {classesLoading && <p className="text-sm text-slate-400 text-center py-6">Loading classes…</p>}
              {!classesLoading && classes.length === 0 && (
                <div className="card text-center py-10 border-dashed border-2 border-slate-200">
                  <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-slate-500 text-sm">No classes yet — create one above to get a join code.</p>
                </div>
              )}
              {classes.map(c => (
                <div key={c._id} className="card">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <p className="font-medium text-slate-800">{c.name}</p>
                      <button
                        onClick={() => setExpandedClassId(prev => prev === c._id ? null : c._id)}
                        className="text-xs text-slate-500 hover:text-blue-600 transition-colors underline decoration-dotted underline-offset-2"
                      >
                        {c.subject} · {c.examType} · {c.studentCount} student{c.studentCount !== 1 ? 's' : ''}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => copyCode(c.joinCode)}
                        className="btn-secondary text-sm"
                      >
                        <Copy className="w-3.5 h-3.5" /> {c.joinCode}
                      </button>
                      <button
                        onClick={() => handleDeleteClass(c)}
                        className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                        aria-label={`Delete ${c.name}`}
                        title="Delete class"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {expandedClassId === c._id && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      {c.students.length === 0 ? (
                        <p className="text-xs text-slate-400">No students have joined yet — share the join code above.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {c.students.map(s => (
                            <div
                              key={s._id}
                              className="flex items-center gap-1 hover:bg-slate-50 rounded-lg px-2 py-1 -mx-2 transition-colors"
                            >
                              <button
                                onClick={() => openStudentInsight(c, s)}
                                className="flex-1 flex items-center justify-between text-sm text-left min-w-0"
                              >
                                <span className="text-slate-700 truncate">{s.fullName}</span>
                                <span className="text-xs text-slate-400 flex-shrink-0 ml-2">{s.email}</span>
                              </button>
                              <button
                                onClick={() => handleRemoveStudent(c, s)}
                                className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors flex-shrink-0"
                                aria-label={`Remove ${s.fullName} from ${c.name}`}
                                title="Remove from class"
                              >
                                <UserMinus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Student insight panel — struggling topics from practice + mock */}
            {viewingStudent && (
              <div className="card animate-fade-in">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-slate-800" style={{ fontFamily: 'var(--font-heading)' }}>
                      {viewingStudent.fullName}
                    </h3>
                    <p className="text-xs text-slate-500">{viewingStudent.subject} — practice & mock performance</p>
                  </div>
                  <button
                    onClick={() => setViewingStudent(null)}
                    className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {studentMasteryLoading && <p className="text-sm text-slate-400 text-center py-8">Loading…</p>}

                {!studentMasteryLoading && studentMastery && (
                  <div className="space-y-5">
                    {studentMastery.strugglingTopics.length > 0 ? (
                      <div className="light-surface bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                        <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5 mb-2">
                          <AlertTriangle className="w-3.5 h-3.5" /> Struggling topics
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {studentMastery.strugglingTopics.map((t, i) => (
                            <span key={i} className="badge-gray text-xs">
                              {t.topic} <span className="text-slate-400">({t.source === 'mock' ? 'mock' : 'practice'} {t.score}%)</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400">No weak topics detected yet — not enough practice/mock data, or performing well across the board.</p>
                    )}

                    {studentMastery.masteryHeatmap.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-600 mb-2">Practice mastery by topic</p>
                        <MasteryHeatmap data={studentMastery.masteryHeatmap} />
                      </div>
                    )}

                    {studentMastery.mockTopicAccuracy.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-600 mb-2">Mock exam accuracy by topic</p>
                        <div className="space-y-1.5">
                          {studentMastery.mockTopicAccuracy.map((t, i) => (
                            <div key={i} className="flex items-center justify-between text-sm">
                              <span className="text-slate-700">{t.topic}</span>
                              <span className={`text-xs font-semibold ${t.accuracy < 50 ? 'text-red-600' : 'text-slate-500'}`}>
                                {t.accuracy}% ({t.attempts} question{t.attempts !== 1 ? 's' : ''})
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {studentMastery.scannedPracticeAnswers?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-600 mb-2">
                          Scanned practice answers <span className="text-slate-400 font-normal">(read-only — already AI-marked and applied)</span>
                        </p>
                        <div className="space-y-3">
                          {studentMastery.scannedPracticeAnswers.map((a, i) => (
                            <div key={i} className="border border-slate-200 rounded-xl p-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-teal-700">{a.topic}</span>
                                <span className="text-xs text-slate-400">
                                  {a.marksAwarded}/{a.marksAvailable} marks · {new Date(a.date).toLocaleDateString('en-GB')}
                                </span>
                              </div>
                              {a.scannedFiles?.length > 0 ? (
                                <ScannedFilesViewer files={a.scannedFiles} />
                              ) : (
                                <p className="text-sm text-slate-600 whitespace-pre-line">{a.studentAnswer}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <button onClick={startRemedialAssignment} className="btn-primary w-full py-2.5">
                      <Target className="w-4 h-4" /> Create remedial assignment for {viewingStudent.fullName.split(' ')[0]}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Assignments overview */}
            {assignments.length > 0 && (
              <div className="card">
                <h3 className="section-title">Assignments given</h3>
                <div className="space-y-2">
                  {assignments.map(a => (
                    <div key={a._id} className="py-2 border-b border-slate-100 last:border-0">
                      {editingAssignmentId === a._id ? (
                        <div className="space-y-2 py-1">
                          <input
                            type="text" value={editForm.title}
                            onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))}
                            placeholder="Assignment title"
                            className="input"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="label text-xs">Due date</label>
                              <input
                                type="date" value={editForm.dueDate}
                                onChange={e => setEditForm(p => ({ ...p, dueDate: e.target.value }))}
                                className="input"
                              />
                            </div>
                            <div>
                              <label className="label text-xs">Release on</label>
                              <input
                                type="date" value={editForm.releaseDate}
                                onChange={e => setEditForm(p => ({ ...p, releaseDate: e.target.value }))}
                                className="input"
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleSaveAssignment(a._id)}
                              disabled={savingAssignment}
                              className="btn-primary text-sm py-2 px-3 flex-1"
                            >
                              {savingAssignment ? <span className="spinner w-3.5 h-3.5 border-white/40 border-t-white" /> : 'Save'}
                            </button>
                            <button
                              onClick={() => setEditingAssignmentId(null)}
                              className="btn-secondary text-sm py-2 px-3 flex-1"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-700 truncate">{a.title}</p>
                            <p className="text-xs text-slate-400">
                              {a.subject} · {a.format === 'file' ? 'PDF handout' : `${a.questionCount} question${a.questionCount !== 1 ? 's' : ''}`}
                              {a.dueDate && ` · due ${new Date(a.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {a.releaseDate && new Date(a.releaseDate) > new Date() && (
                              <span className="badge-amber text-xs flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                Releases {new Date(a.releaseDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                              </span>
                            )}
                            <span className="badge-blue text-xs">{a.submittedCount}/{a.totalStudents} submitted</span>
                            <button
                              onClick={() => toggleAssignmentSubmissions(a._id)}
                              className={`p-1.5 rounded-md transition-colors ${openSubmissionsId === a._id ? 'text-blue-600 bg-blue-50' : 'text-slate-300 hover:text-blue-600 hover:bg-blue-50'}`}
                              aria-label={`View submissions for ${a.title}`}
                              title="View students' work"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleAssignToNewStudents(a)}
                              disabled={assigningNewIds.includes(a._id)}
                              className="p-1.5 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                              aria-label={`Assign ${a.title} to newly joined students`}
                              title="Assign to newly joined students"
                            >
                              {assigningNewIds.includes(a._id)
                                ? <span className="spinner w-3.5 h-3.5" />
                                : <UserPlus className="w-3.5 h-3.5" />
                              }
                            </button>
                            <button
                              onClick={() => openEditAssignment(a)}
                              className="p-1.5 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                              aria-label={`Edit ${a.title}`}
                              title="Edit title/due date"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteAssignment(a)}
                              className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                              aria-label={`Delete ${a.title}`}
                              title="Delete assignment"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                      {openSubmissionsId === a._id && (
                        <div className="mt-3 border-t border-slate-100 pt-3 space-y-1.5">
                          {assignmentSubsLoading && <p className="text-xs text-slate-400">Loading…</p>}
                          {!assignmentSubsLoading && assignmentSubs.length === 0 && (
                            <p className="text-xs text-slate-400">No students on this assignment.</p>
                          )}
                          {assignmentSubs.map(s => {
                            const submitted = ['submitted', 'pending_review', 'marked'].includes(s.status)
                            return (
                              <div key={s.submissionId} className="flex items-center justify-between gap-3 text-sm">
                                <span className="text-slate-700 truncate">{s.studentName}</span>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  {s.status === 'marked' && (
                                    <span className="text-xs text-slate-500">{s.totalMarks}/{s.availableMarks} ({s.percent}%)</span>
                                  )}
                                  <span className={`text-xs ${s.status === 'pending_review' ? 'badge-amber' : s.status === 'marked' ? 'badge-teal' : 'badge-gray'}`}>
                                    {s.status === 'pending_review' ? 'Awaiting review'
                                      : s.status === 'marked' ? 'Marked'
                                      : s.status === 'submitted' ? 'Submitted'
                                      : s.status === 'in_progress' ? 'In progress' : 'Not started'}
                                  </span>
                                  {submitted && (
                                    <button onClick={() => openSubmission(s.submissionId)} className="text-xs font-medium text-blue-600 hover:underline">
                                      {s.status === 'pending_review' ? 'Review' : 'View'}
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {assignmentsLoading && <p className="text-sm text-slate-400 text-center py-4">Loading assignments…</p>}
          </div>
        )}

        {/* ── New Assignment tab ─────────────────────────────── */}
        {tab === 'assignment' && (
          <div className="space-y-5 animate-fade-in">

            {classes.length === 0 ? (
              <div className="card text-center py-10 border-dashed border-2 border-slate-200">
                <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-slate-500 text-sm">Create a class first, under "My Classes".</p>
              </div>
            ) : (
              <>
                {targetStudent && (
                  <div className="flex items-center justify-between gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5">
                    <p className="text-sm text-blue-800">
                      <Target className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                      Assigning to <strong>{targetStudent.fullName}</strong> only
                    </p>
                    <button
                      onClick={() => setTargetStudent(null)}
                      className="text-xs text-blue-600 hover:text-blue-800 underline decoration-dotted underline-offset-2"
                    >
                      Assign to whole class instead
                    </button>
                  </div>
                )}

                {/* Class + title + due date + release date */}
                <div className="card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="label">Class</label>
                    <select
                      value={selectedClassId}
                      onChange={e => { setSelectedClassId(e.target.value); setTargetStudent(null) }}
                      className="input"
                    >
                      <option value="">Select a class…</option>
                      {classes.map(c => (
                        <option key={c._id} value={c._id}>{c.name} ({c.subject})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Title</label>
                    <input
                      type="text" value={title} onChange={e => setTitle(e.target.value)}
                      placeholder="e.g. Week 3 Remedial" className="input"
                    />
                  </div>
                  <div>
                    <label className="label">Due date <span className="text-slate-400 font-normal">(optional)</span></label>
                    <input
                      type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label">Release on <span className="text-slate-400 font-normal">(optional)</span></label>
                    <input
                      type="date" value={releaseDate} onChange={e => setReleaseDate(e.target.value)}
                      className="input"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">Leave blank to send immediately</p>
                  </div>
                </div>

                {selectedClass && (
                  <>
                    {/* Assignment type */}
                    <div className="card">
                      <label className="label">Assignment type</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {[
                          { value: 'questions', label: 'Question-based', desc: 'Build from AI-generated, PDF-extracted or manually typed questions' },
                          { value: 'file',      label: 'PDF handout',    desc: 'Send one PDF as-is — students download it, solve it, and upload their work back' },
                        ].map(({ value, label, desc }) => (
                          <button
                            key={value}
                            onClick={() => setAssignmentFormat(value)}
                            className={`py-2.5 px-3 rounded-lg text-sm font-medium border-2 text-left transition-all ${
                              assignmentFormat === value
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-surface text-slate-600 border-slate-200 hover:border-blue-300'
                            }`}
                          >
                            {label}
                            <p className={`text-xs mt-0.5 font-normal ${assignmentFormat === value ? 'text-blue-100' : 'text-slate-400'}`}>{desc}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {assignmentFormat === 'file' && (
                      <div className="card space-y-4">
                        <div>
                          <label className="label">Assignment PDF</label>
                          {attachmentFile ? (
                            <div className="flex items-center gap-3 flex-wrap">
                              <ScannedFilesViewer files={[attachmentFile]} label={attachmentFile.filename || 'View PDF'} />
                              <button
                                onClick={() => setAttachmentFile(null)}
                                className="text-xs text-slate-400 hover:text-red-500 underline decoration-dotted underline-offset-2"
                              >
                                Remove
                              </button>
                            </div>
                          ) : (
                            <label className={`inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 cursor-pointer transition-colors ${uploadingAttachment ? 'opacity-50 pointer-events-none' : ''}`}>
                              <FileText className="w-4 h-4" />
                              {uploadingAttachment ? 'Reading…' : 'Upload a PDF'}
                              <input
                                type="file" accept="application/pdf" className="hidden"
                                onChange={e => handleAttachmentUpload(e.target.files[0])}
                                disabled={uploadingAttachment}
                              />
                            </label>
                          )}
                        </div>
                        <div className="max-w-[160px]">
                          <label className="label">Total marks</label>
                          <input
                            type="number" min={1} value={maxMarks}
                            onChange={e => setMaxMarks(e.target.value)}
                            className="input"
                          />
                        </div>
                        <button
                          onClick={handleCreateAssignment}
                          disabled={creatingAssignment}
                          className="btn-primary w-full py-3"
                        >
                          {creatingAssignment
                            ? <><span className="spinner border-white/40 border-t-white" /> Creating…</>
                            : targetStudent
                              ? <>Create & assign to {targetStudent.fullName} <ArrowRight className="w-4 h-4" /></>
                              : <>Create & assign to {selectedClass.studentCount} student{selectedClass.studentCount !== 1 ? 's' : ''} <ArrowRight className="w-4 h-4" /></>
                          }
                        </button>
                      </div>
                    )}
                  </>
                )}

                {selectedClass && assignmentFormat === 'questions' && (
                  <>
                    {/* Question source picker */}
                    {!activeTool && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <button onClick={() => setActiveTool('ai')} className="card flex flex-col items-center gap-2 py-6 hover:border-blue-300 border-2 border-transparent transition-colors">
                          <Cpu className="w-6 h-6 text-purple-600" />
                          <span className="text-sm font-medium text-slate-700">AI Generate</span>
                        </button>
                        <button onClick={() => setActiveTool('pdf')} className="card flex flex-col items-center gap-2 py-6 hover:border-blue-300 border-2 border-transparent transition-colors">
                          <FileSearch className="w-6 h-6 text-green-600" />
                          <span className="text-sm font-medium text-slate-700">Upload PDF</span>
                        </button>
                        <button onClick={() => setActiveTool('manual')} className="card flex flex-col items-center gap-2 py-6 hover:border-blue-300 border-2 border-transparent transition-colors">
                          <Type className="w-6 h-6 text-teal-600" />
                          <span className="text-sm font-medium text-slate-700">Type manually</span>
                        </button>
                      </div>
                    )}

                    {activeTool && (
                      <div className="card">
                        <button
                          onClick={() => setActiveTool(null)}
                          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600 mb-4 transition-colors"
                        >
                          <X className="w-4 h-4" /> Cancel
                        </button>

                        {activeTool === 'ai' && (
                          <AIGeneratorPanel
                            onGenerate={(config) => teacherAPI.generateQuestions(config)}
                            onApprove={addToDraft}
                            lockedSubject={selectedClass.subject}
                            lockedExamType={selectedClass.examType}
                            hideBankNotice
                          />
                        )}
                        {activeTool === 'pdf' && (
                          <PDFExtractorPanel
                            onExtract={(data) => teacherAPI.extractFromPDF(data)}
                            onApprove={addToDraft}
                            lockedSubject={selectedClass.subject}
                            lockedExamType={selectedClass.examType}
                            hideQuestionSource
                          />
                        )}
                        {activeTool === 'manual' && (
                          <ManualQuestionForm
                            subject={selectedClass.subject}
                            examType={selectedClass.examType}
                            showQuestionSource={false}
                            submitLabel="Add to assignment"
                            onAdd={(q) => addToDraft([q])}
                          />
                        )}
                      </div>
                    )}

                    {/* Draft summary */}
                    {draftQuestions.length > 0 && (
                      <div className="card">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="font-semibold text-slate-800" style={{ fontFamily: 'var(--font-heading)' }}>
                            Assignment draft — {draftQuestions.length} question{draftQuestions.length !== 1 ? 's' : ''}
                          </h3>
                          <span className="badge-blue text-xs">{totalMarks} marks total</span>
                        </div>
                        <div className="space-y-2">
                          {draftQuestions.map((q, idx) => (
                            <div key={idx} className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="badge-gray text-xs flex-shrink-0">{q.type}</span>
                                <span className="text-sm text-slate-700 truncate">{q.questionText}</span>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-xs text-slate-400">{q.marks}m</span>
                                <button onClick={() => removeFromDraft(idx)} className="p-1 text-red-400 hover:bg-red-50 rounded-lg transition-colors">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>

                        <button
                          onClick={handleCreateAssignment}
                          disabled={creatingAssignment}
                          className="btn-primary w-full py-3 mt-4"
                        >
                          {creatingAssignment
                            ? <><span className="spinner border-white/40 border-t-white" /> Creating…</>
                            : targetStudent
                              ? <>Create & assign to {targetStudent.fullName} <ArrowRight className="w-4 h-4" /></>
                              : <>Create & assign to {selectedClass.studentCount} student{selectedClass.studentCount !== 1 ? 's' : ''} <ArrowRight className="w-4 h-4" /></>
                          }
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Review Submissions tab ─────────────────────────── */}
        {tab === 'review' && (
          reviewing?.type === 'assignment' ? (
            <SubmissionReviewPanel
              submissionId={reviewing.id}
              backLabel={reviewing.from === 'classes' ? 'Back to my classes' : 'Back to review queue'}
              onBack={() => { const from = reviewing.from; setReviewing(null); if (from) setTab(from) }}
              onPublished={() => { const from = reviewing.from; setReviewing(null); from ? setTab(from) : loadPendingReviews() }}
            />
          ) : reviewing?.type === 'mockExam' ? (
            <MockExamReviewPanel
              examId={reviewing.id}
              onBack={() => setReviewing(null)}
              onPublished={() => { setReviewing(null); loadPendingReviews() }}
            />
          ) : (
            <div className="space-y-3 animate-fade-in">
              {reviewsLoading && <p className="text-sm text-slate-400 text-center py-10">Loading…</p>}
              {!reviewsLoading && pendingReviews.length === 0 && (
                <div className="card text-center py-14 border-dashed border-2 border-slate-200">
                  <ClipboardCheck className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-slate-500 text-sm">Nothing awaiting review.</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Submissions land here only when a student photographs an answer instead of typing it.
                  </p>
                </div>
              )}
              {pendingReviews.map(r => (
                <button
                  key={`${r.type}-${r.id}`}
                  onClick={() => setReviewing({ type: r.type, id: r.id })}
                  className="card w-full flex items-center justify-between gap-3 text-left hover:border-blue-300 border-2 border-transparent transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <Camera className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-slate-800 truncate">{r.title}</p>
                        <span className="badge-gray text-[10px] flex-shrink-0">
                          {r.type === 'mockExam' ? 'Mock Exam' : 'Assignment'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">{r.studentName} · {r.subject}</p>
                    </div>
                  </div>
                  <span className="text-xs text-slate-400 flex-shrink-0">
                    {r.submittedAt ? new Date(r.submittedAt).toLocaleDateString('en-GB') : ''}
                  </span>
                </button>
              ))}
            </div>
          )
        )}

        {/* ── Analytics tab ────────────────────────────────────── */}
        {tab === 'analytics' && (
          <div className="space-y-5 animate-fade-in">
            {classes.length === 0 ? (
              <div className="card text-center py-10 border-dashed border-2 border-slate-200">
                <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-slate-500 text-sm">Create a class first, under "My Classes".</p>
              </div>
            ) : (
              <>
                <div className="card flex items-end justify-between flex-wrap gap-3">
                  <div className="flex-1 min-w-48">
                    <label className="label">Class</label>
                    <select
                      value={analyticsClassId}
                      onChange={e => setAnalyticsClassId(e.target.value)}
                      className="input"
                    >
                      {classes.map(c => (
                        <option key={c._id} value={c._id}>{c.name} ({c.subject})</option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={() => handleExportClass(analyticsClassId, classes.find(c => c._id === analyticsClassId)?.name || 'class')}
                    disabled={exportingClass || !analyticsClassId}
                    className="btn-secondary"
                  >
                    {exportingClass
                      ? <span className="spinner w-3.5 h-3.5 border-current border-t-transparent" />
                      : <Download className="w-4 h-4" />
                    }
                    Export CSV
                  </button>
                </div>

                {analyticsLoading && <p className="text-sm text-slate-400 text-center py-10">Loading…</p>}

                {!analyticsLoading && analytics && (
                  analytics.studentCount === 0 ? (
                    <div className="card text-center py-10 border-dashed border-2 border-slate-200">
                      <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-slate-500 text-sm">No students have joined this class yet.</p>
                    </div>
                  ) : (
                    <>
                      {/* Stat cards */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="card text-center py-5">
                          <p className="text-2xl font-semibold text-slate-900" style={{ fontFamily: 'var(--font-heading)' }}>
                            {analytics.studentCount}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">Students</p>
                        </div>
                        <div className="card text-center py-5">
                          <p className="text-2xl font-semibold text-slate-900" style={{ fontFamily: 'var(--font-heading)' }}>
                            {analytics.avgMasteryScore}%
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">Avg practice mastery</p>
                        </div>
                        <div className="card text-center py-5">
                          <p className="text-2xl font-semibold text-slate-900" style={{ fontFamily: 'var(--font-heading)' }}>
                            {analytics.assignmentCompletion.avgCompletionRate}%
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Assignment completion{analytics.assignmentCompletion.totalAssignments > 0 && ` (${analytics.assignmentCompletion.totalAssignments})`}
                          </p>
                        </div>
                      </div>

                      {/* Weakest topics */}
                      {analytics.weakestTopics.length > 0 && (
                        <div className="card">
                          <h3 className="section-title">Weakest topics across the class</h3>
                          <div className="space-y-3.5">
                            {analytics.weakestTopics.map(t => (
                              <div key={t.topic}>
                                <div className="flex justify-between text-sm mb-1">
                                  <span className="text-slate-700">{t.topic}</span>
                                  <span className="text-xs text-slate-400">
                                    {t.avgScore}% avg · {t.studentCount} student{t.studentCount !== 1 ? 's' : ''}
                                  </span>
                                </div>
                                <div className="progress-bar">
                                  <div className="progress-fill bg-amber-500" style={{ width: `${t.avgScore}%` }} />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Leaderboard */}
                      <div className="card">
                        <h3 className="section-title">Leaderboard</h3>
                        <div className="space-y-1">
                          {analytics.leaderboard.map((s, i) => (
                            <div key={s.studentId} className="flex items-center gap-3 py-1.5 border-b border-slate-100 last:border-0">
                              <span className="w-6 text-xs font-semibold text-slate-400 flex-shrink-0">{i + 1}</span>
                              <span className="flex-1 text-sm text-slate-700 truncate">{s.fullName}</span>
                              <span className="text-xs text-slate-400 flex items-center gap-1 flex-shrink-0">
                                <Flame className="w-3 h-3 text-amber-500" /> {s.streak}
                              </span>
                              <span className="badge-blue text-xs flex-shrink-0">
                                {s.avgMasteryScore ?? '—'}% mastery
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )
                )}
              </>
            )}
          </div>
        )}

        {/* ── Announcements tab ────────────────────────────────── */}
        {tab === 'announcements' && (
          <div className="space-y-5 animate-fade-in">
            {classes.length === 0 ? (
              <div className="card text-center py-10 border-dashed border-2 border-slate-200">
                <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-slate-500 text-sm">Create a class first, under "My Classes".</p>
              </div>
            ) : (
              <>
                <div className="card space-y-3">
                  <div>
                    <label className="label">Class</label>
                    <select
                      value={announceClassId}
                      onChange={e => setAnnounceClassId(e.target.value)}
                      className="input"
                    >
                      {classes.map(c => (
                        <option key={c._id} value={c._id}>{c.name} ({c.subject})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Message</label>
                    <textarea
                      value={newAnnouncement}
                      onChange={e => setNewAnnouncement(e.target.value)}
                      placeholder="e.g. Bring your calculators to next week's mock exam."
                      rows={3}
                      className="input resize-none"
                    />
                  </div>
                  <button
                    onClick={handlePostAnnouncement}
                    disabled={postingAnnouncement}
                    className="btn-primary w-full py-2.5"
                  >
                    {postingAnnouncement
                      ? <span className="spinner border-white/40 border-t-white" />
                      : <Megaphone className="w-4 h-4" />
                    }
                    Post to class
                  </button>
                </div>

                <div className="card">
                  <h3 className="section-title">Posted announcements</h3>
                  {announcementsLoading && <p className="text-sm text-slate-400 text-center py-6">Loading…</p>}
                  {!announcementsLoading && announcements.length === 0 && (
                    <p className="text-sm text-slate-400 text-center py-6">Nothing posted to this class yet.</p>
                  )}
                  <div className="space-y-1">
                    {announcements.map(a => (
                      <div key={a._id} className="flex items-start justify-between gap-3 py-2.5 border-b border-slate-100 last:border-0">
                        <div className="min-w-0">
                          <p className="text-sm text-slate-700 whitespace-pre-line">{a.message}</p>
                          <p className="text-xs text-slate-400 mt-1">
                            {new Date(a.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDeleteAnnouncement(a)}
                          className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors flex-shrink-0"
                          aria-label="Delete announcement"
                          title="Delete announcement"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── My Subjects tab ─────────────────────────────────── */}
        {tab === 'subjects' && (
          <div className="card max-w-lg animate-fade-in">
            <h3 className="section-title flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-600" /> My subjects
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Choose your school level and the subjects you teach — this decides which subjects
              you can create classes for.
            </p>
            <SubjectLevelPicker
              level={myLevel} setLevel={setMyLevel}
              subjects={mySubjects} setSubjects={setMySubjects}
            />
            <button
              onClick={handleSaveSubjects}
              disabled={savingSubjects}
              className="btn-primary w-full py-3 mt-5"
            >
              {savingSubjects
                ? <span className="spinner border-white/40 border-t-white" />
                : 'Save changes'
              }
            </button>
          </div>
        )}
      </div>
    </TeacherShell>
  )
}
