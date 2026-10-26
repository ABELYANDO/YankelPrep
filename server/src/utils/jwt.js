import jwt from 'jsonwebtoken'

// ── Generate a token ───────────────────────────────────────────
// Called after registration and login.
// The token contains the user's ID and role — nothing sensitive.
export const generateToken = (userId, role) => {
  return jwt.sign(
    { id: userId, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  )
}

// ── Verify a token ─────────────────────────────────────────────
// Called by the auth middleware on every protected route.
export const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET)
}

// ── Explanation tokens ─────────────────────────────────────────
// Issued by practice submitAnswer once an answer has been marked, and
// required by the explain endpoint — proof that this student actually
// attempted this question, so explanations (which reveal the correct
// answer) can't be fetched for questions not yet attempted. Carries a
// `purpose` claim so it can never be accepted as a login token
// (protect() looks users up by `id`, which this token doesn't have).
export const generateExplainToken = (userId, questionId) => {
  return jwt.sign(
    { purpose: 'explain', uid: String(userId), qid: String(questionId) },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  )
}

export const isValidExplainToken = (token, userId, questionId) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    return decoded.purpose === 'explain' &&
      decoded.uid === String(userId) &&
      decoded.qid === String(questionId)
  } catch {
    return false
  }
}