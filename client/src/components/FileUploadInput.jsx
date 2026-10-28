import { useState } from 'react'
import { Camera, FileText, X, CheckCircle2 } from 'lucide-react'
import ScannedFilesViewer from './ScannedFilesViewer'
import { fileToBase64, photoToBase64 } from '../utils/fileUtils'

// ── FileUploadInput ──────────────────────────────────────────────
// Lets someone attach a document as either multiple photo pages or a
// single PDF — no AI transcription involved, unlike PhotoAnswerInput.
// Used for a PDF-handout assignment: the teacher's original attachment,
// and the student's solved-work submission, are both graded by a human
// reading the file directly, not against a structured question.
export default function FileUploadInput({
  files = [],       // [{ data, mimeType, filename }]
  onChange,          // (files) => void
  disabled = false,
  photoLabel = 'Upload photo(s)',
  pdfLabel = 'Upload a PDF instead',
}) {
  const [error, setError] = useState('')
  const isPdf = files.length === 1 && files[0].mimeType === 'application/pdf'

  const handlePhotos = async (fileList) => {
    const newFiles = Array.from(fileList || [])
    if (newFiles.length === 0) return
    try {
      const converted = await Promise.all(newFiles.map(async f => ({
        ...(await photoToBase64(f)), filename: f.name,
      })))
      // Photos accumulate across multiple picks; switching away from a
      // previously-attached PDF starts a fresh photo set.
      const base = isPdf ? [] : files
      onChange([...base, ...converted])
      setError('')
    } catch (err) {
      setError(err.message || 'Could not read that photo')
    }
  }

  const handlePdf = async (file) => {
    if (!file) return
    try {
      const data = await fileToBase64(file)
      onChange([{ data, mimeType: file.type, filename: file.name }])
      setError('')
    } catch (err) {
      setError(err.message || 'Could not read that PDF')
    }
  }

  const removeFile = (index) => onChange(files.filter((_, i) => i !== index))

  return (
    <div>
      {!disabled && (
        <div className="flex flex-wrap items-center gap-4 mb-2">
          <label className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-600 hover:text-teal-700 cursor-pointer transition-colors">
            <Camera className="w-4 h-4" />
            {files.length > 0 && !isPdf ? 'Add / retake photos' : photoLabel}
            <input
              type="file" accept="image/*" multiple className="hidden"
              onChange={e => { handlePhotos(e.target.files); e.target.value = '' }}
            />
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 cursor-pointer transition-colors">
            <FileText className="w-4 h-4" />
            {pdfLabel}
            <input
              type="file" accept="application/pdf" className="hidden"
              onChange={e => { handlePdf(e.target.files[0]); e.target.value = '' }}
            />
          </label>
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-1">
          <div className="flex items-start gap-2">
            <ScannedFilesViewer files={files} label={files[0].filename || 'View PDF'} />
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
              {files.map((_, i) => (
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
              {isPdf ? 'PDF' : `${files.length} page${files.length !== 1 ? 's' : ''}`} attached
            </p>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
    </div>
  )
}
