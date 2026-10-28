import { useState } from 'react'
import { Camera, FileText, CheckCircle2, X } from 'lucide-react'
import ScannedFilesViewer from './ScannedFilesViewer'
import { fileToBase64, photoToBase64 } from '../utils/fileUtils'

// ── PhotoAnswerInput ─────────────────────────────────────────────
// Replaces PartAnswerEditor for a student in a teacher's class — the
// scanned file(s) are the record, not a typed/editable transcription
// (unlike the Assignment flow, which offers scanning as an option
// alongside a still-editable textarea). Supports either multiple photo
// pages or a single PDF as an alternative — never both at once, since
// a PDF is already a complete multi-page document on its own.
// `extractPhoto` is the transcribe-only API call to use
// (practiceAPI/mockExamAPI/assignmentAPI each mount the same server
// handler under their own route).
export default function PhotoAnswerInput({
  onCaptured,        // ({ transcribedText, files }) => void — files: [{ data, mimeType }]
  extractPhoto,       // (files, questionText) => Promise<{ transcribedAnswer }>
  questionText,
  disabled = false,
  hasAnswer = false,
  filesPreview = [],  // [{ data, mimeType }] — shown once captured
}) {
  const [scanning, setScanning] = useState(false)
  const [error,    setError]    = useState('')

  const isPdf = filesPreview.length === 1 && filesPreview[0].mimeType === 'application/pdf'

  const runExtraction = async (files) => {
    setScanning(true)
    setError('')
    try {
      const data = await extractPhoto(files, questionText)
      onCaptured({ transcribedText: data.transcribedAnswer || '', files })
    } catch (err) {
      setError(err.message || 'Could not read that')
    } finally {
      setScanning(false)
    }
  }

  const handlePhotos = async (fileList) => {
    const newFiles = Array.from(fileList || [])
    if (newFiles.length === 0) return
    try {
      const converted = await Promise.all(newFiles.map(photoToBase64))
      // Photos accumulate across multiple picks; switching away from a
      // previously-attached PDF starts a fresh photo set instead of
      // mixing document types.
      const base = isPdf ? [] : filesPreview
      await runExtraction([...base, ...converted])
    } catch (err) {
      setError(err.message || 'Could not read that photo')
    }
  }

  const handlePdf = async (file) => {
    if (!file) return
    try {
      const data = await fileToBase64(file)
      await runExtraction([{ data, mimeType: file.type }])
    } catch (err) {
      setError(err.message || 'Could not read that PDF')
    }
  }

  const removeFile = (index) => {
    const next = filesPreview.filter((_, i) => i !== index)
    if (next.length === 0) {
      onCaptured({ transcribedText: '', files: [] })
    } else {
      runExtraction(next)
    }
  }

  return (
    <div>
      {!disabled && (
        <div className={`flex flex-wrap items-center gap-4 mb-2 ${scanning ? 'opacity-50 pointer-events-none' : ''}`}>
          <label className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-600 hover:text-teal-700 cursor-pointer transition-colors">
            <Camera className="w-4 h-4" />
            {scanning ? 'Reading…' : hasAnswer && !isPdf ? 'Add / retake photos' : 'Upload photo(s) of your answer'}
            <input
              type="file" accept="image/*" multiple className="hidden"
              onChange={e => { handlePhotos(e.target.files); e.target.value = '' }}
              disabled={scanning}
            />
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 cursor-pointer transition-colors">
            <FileText className="w-4 h-4" />
            Upload a PDF instead
            <input
              type="file" accept="application/pdf" className="hidden"
              onChange={e => { handlePdf(e.target.files[0]); e.target.value = '' }}
              disabled={scanning}
            />
          </label>
        </div>
      )}

      {filesPreview.length > 0 && (
        <div className="mt-1">
          <div className="flex items-start gap-2">
            <ScannedFilesViewer files={filesPreview} />
            {!disabled && isPdf && (
              <button
                type="button"
                onClick={() => removeFile(0)}
                className="text-slate-400 hover:text-red-500 transition-colors flex-shrink-0"
                aria-label="Remove PDF"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {!disabled && !isPdf && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {filesPreview.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => removeFile(i)}
                  className="text-xs text-slate-400 hover:text-red-500 transition-colors underline decoration-dotted underline-offset-2"
                >
                  Remove page {i + 1}
                </button>
              ))}
            </div>
          )}
          {!disabled && (
            <p className="text-xs text-teal-600 flex items-center gap-1 mt-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {isPdf ? 'PDF' : filesPreview.length > 1 ? `${filesPreview.length} pages` : 'Photo'} uploaded and read
            </p>
          )}
        </div>
      )}

      {filesPreview.length === 0 && !disabled && (
        <p className="text-xs text-slate-400">Your teacher will review your actual written answer from the photo(s) or PDF.</p>
      )}

      {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
    </div>
  )
}
