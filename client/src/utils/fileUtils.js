export const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload  = () => resolve(reader.result.split(',')[1])
  reader.onerror = () => reject(new Error('Failed to read file'))
  reader.readAsDataURL(file)
})

// Phone photos are often 3–6 MB each; a few pages at full size exceed
// the API's 10 MB request limit and the save fails, losing the photos.
// Scaling to 1600 px on the long side keeps handwriting and diagrams
// legible at a few hundred KB. Falls back to the original file if the
// browser can't decode it (e.g. HEIC on some browsers).
const MAX_PHOTO_SIDE = 1600

// Returns { data (base64), mimeType }.
export const photoToBase64 = async (file) => {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width  = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff' // transparent PNGs would otherwise turn black as JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    return { data: canvas.toDataURL('image/jpeg', 0.82).split(',')[1], mimeType: 'image/jpeg' }
  } catch {
    return { data: await fileToBase64(file), mimeType: file.type }
  }
}
