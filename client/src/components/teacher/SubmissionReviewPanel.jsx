import { useState, useEffect } from 'react'
import { teacherAPI } from '../../api/teacher.api'
import MathText from '../MathText'
import ScannedFilesViewer from '../ScannedFilesViewer'
import { Camera, ArrowLeft, Send } from 'lucide-react'
import toast from 'react-hot-toast'

// ── Auto-grow a textarea to fit its content ─────────────────────
// A fixed `rows` count clips anything longer — AI-suggested feedback
// routinely runs past 2-3 lines, and with `resize-none` that text is
// just invisible below the fold with no scroll affordance on mobile.
// Passed as a ref callback, so it re-measures on every render (new
// value → new inline function identity → React re-calls the ref)
// without needing separate state/effects.
const autoSize = (el) => {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// ── SubmissionReviewPanel ────────────────────────────────────────
// Shown when a teacher opens one pending-review submission. Two shapes:
// a question-based assignment (reached when the student scanned at
// least one answer as a photo — every question's AI-suggested
// mark/feedback is pre-filled and editable), or a PDF-handout
// assignment (assignment.format === 'file' — every submission needs
// review, since there's no per-question auto-marking to check; the
// teacher just reads the student's file and enters one overall mark).
// Opened on a submission that isn't awaiting review (already published,
// or instantly marked typed answers), it is read-only: marks are shown,
// with the AI's original mark wherever the teacher changed it.
export default function SubmissionReviewPanel({ submissionId, onBack, onPublished, backLabel = 'Back to review queue' }) {
  const [loading,   setLoading]   = useState(true)
  const [data,      setData]      = useState(null)
  const [overrides, setOverrides] = useState([]) // [{ marksAwarded, aiFeedback }] — question-based only
  const [fileMarks,    setFileMarks]    = useState(0)    // file-based only
  const [fileFeedback, setFileFeedback] = useState('')   // file-based only
  const [publishing, setPublishing] = useState(false)

  useEffect(() => { load() }, [submissionId])

  const load = async () => {
    setLoading(true)
    try {
      const result = await teacherAPI.getSubmissionForReview(submissionId)
      setData(result)
      setOverrides(result.submission.answers.map(a => ({
        marksAwarded: a.marksAwarded ?? 0,
        aiFeedback:   a.aiFeedback || '',
      })))
      const done = result.submission.status !== 'pending_review'
      setFileMarks(done ? result.submission.totalMarks ?? 0 : 0)
      setFileFeedback(done ? result.submission.teacherFeedback || '' : '')
    } catch (err) {
      toast.error(err.message)
      onBack()
    } finally {
      setLoading(false)
    }
  }

  const updateOverride = (idx, field, value) => {
    setOverrides(prev => prev.map((o, i) => i === idx ? { ...o, [field]: value } : o))
  }

  const handlePublish = async () => {
    setPublishing(true)
    try {
      const payload = isFileBased
        ? { totalMarks: Number(fileMarks) || 0, teacherFeedback: fileFeedback }
        : { answers: overrides.map(o => ({ marksAwarded: Number(o.marksAwarded) || 0, aiFeedback: o.aiFeedback })) }
      const result = await teacherAPI.publishSubmission(submissionId, payload)
      toast.success(`Published — ${result.results.totalMarks}/${result.results.availableMarks} (${result.results.percent}%)`)
      onPublished()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setPublishing(false)
    }
  }

  if (loading) return <p className="text-sm text-slate-400 text-center py-10">Loading…</p>
  if (!data) return null

  const { submission, assignment } = data
  const isFileBased = assignment.format === 'file'
  const readOnly = submission.status !== 'pending_review'
  const totalMarks = isFileBased
    ? Number(fileMarks) || 0
    : overrides.reduce((sum, o) => sum + (Number(o.marksAwarded) || 0), 0)
  const availableMarks = isFileBased
    ? submission.availableMarks
    : assignment.questions.reduce((sum, q) => sum + (q.marks || 0), 0)

  return (
    <div className="space-y-5 animate-fade-in">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> {backLabel}
      </button>

      <div className={`card flex items-center justify-between flex-wrap gap-3 ${readOnly ? 'bg-teal-50 border-teal-200' : 'bg-amber-50 border-amber-200'}`}>
        <div>
          <p className={`font-semibold ${readOnly ? 'text-teal-900' : 'text-amber-900'}`}>{assignment.title}</p>
          <p className={`text-sm ${readOnly ? 'text-teal-700' : 'text-amber-700'}`}>
            {submission.studentName} · {assignment.subject}
            {readOnly && submission.submittedAt && ` · submitted ${new Date(submission.submittedAt).toLocaleDateString('en-GB')}`}
          </p>
        </div>
        <span className={`text-sm ${readOnly ? 'badge-teal' : 'badge-amber'}`}>
          {totalMarks}/{availableMarks} marks {readOnly ? '(marked)' : isFileBased ? '' : '(AI-suggested, editable below)'}
        </span>
      </div>

      {isFileBased ? (
        <div className="card space-y-4">
          {assignment.attachmentFile?.data && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Original handout</p>
              <ScannedFilesViewer
                files={[assignment.attachmentFile]}
                label={assignment.attachmentFile.filename || 'View handout PDF'}
              />
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Student's submitted work</p>
            {submission.submissionFiles?.length > 0
              ? <ScannedFilesViewer files={submission.submissionFiles} />
              : <p className="text-sm text-slate-400">No file received.</p>
            }
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
            <div>
              <label className="label">Marks (out of {submission.availableMarks})</label>
              <input
                type="number" min={0} max={submission.availableMarks}
                value={fileMarks}
                onChange={e => setFileMarks(e.target.value)}
                disabled={readOnly}
                className="input"
              />
            </div>
            <div>
              <label className="label">Feedback</label>
              <textarea
                ref={autoSize}
                value={fileFeedback}
                onChange={e => setFileFeedback(e.target.value)}
                rows={3}
                placeholder="Optional comments on the student's work"
                disabled={readOnly}
                className="input resize-none overflow-hidden"
              />
            </div>
          </div>
        </div>
      ) : (
        assignment.questions.map((q, idx) => {
          const answer = submission.answers[idx]
          return (
            <div key={idx} className="card">
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-medium text-slate-800 flex-1">
                  <span className="text-slate-400 mr-1.5">{idx + 1}.</span>
                  <MathText text={q.questionText} />
                </p>
                <span className="badge-gray text-xs flex-shrink-0">{q.marks} marks</span>
              </div>

              <div className="bg-slate-50 rounded-xl p-3 mb-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Student's answer</p>
                  {answer?.wasScanned && (
                    <span className="flex items-center gap-1 text-xs text-blue-600">
                      <Camera className="w-3 h-3" /> scanned
                    </span>
                  )}
                </div>
                {answer?.wasScanned && answer?.scannedFiles?.length > 0 && (
                  <ScannedFilesViewer files={answer.scannedFiles} className="mb-2" />
                )}
                <p className="text-sm text-slate-700 whitespace-pre-line">{answer?.studentAnswer || 'Not answered.'}</p>
              </div>

              {q.modelAnswer && (
                <div className="bg-teal-50 rounded-xl p-3 mb-3">
                  <p className="text-xs font-semibold text-teal-600 uppercase tracking-wider mb-1">Model answer</p>
                  <p className="text-sm text-teal-800 whitespace-pre-line">{q.modelAnswer}</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr] gap-3">
                <div>
                  <label className="label">Marks</label>
                  <input
                    type="number" min={0} max={q.marks}
                    value={overrides[idx]?.marksAwarded ?? 0}
                    onChange={e => updateOverride(idx, 'marksAwarded', e.target.value)}
                    disabled={readOnly}
                    className="input"
                  />
                  {answer?.aiMarksAwarded != null && Number(overrides[idx]?.marksAwarded) !== answer.aiMarksAwarded && (
                    <p className="text-xs text-slate-400 mt-1">AI suggested {answer.aiMarksAwarded}</p>
                  )}
                </div>
                <div>
                  <label className="label">Feedback</label>
                  <textarea
                    ref={autoSize}
                    value={overrides[idx]?.aiFeedback ?? ''}
                    onChange={e => updateOverride(idx, 'aiFeedback', e.target.value)}
                    rows={2}
                    disabled={readOnly}
                    className="input resize-none overflow-hidden"
                  />
                </div>
              </div>
            </div>
          )
        })
      )}

      {!readOnly && <button
        onClick={handlePublish}
        disabled={publishing}
        className="btn-primary w-full py-3.5 text-base"
      >
        {publishing
          ? <><span className="spinner border-white/40 border-t-white" /> Publishing…</>
          : <>Publish results to student <Send className="w-4 h-4" /></>
        }
      </button>}
    </div>
  )
}
