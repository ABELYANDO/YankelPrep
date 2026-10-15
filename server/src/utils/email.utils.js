// ── Resend transactional email API ───────────────────────────────
// Switched from direct Gmail SMTP — Render blocks outbound SMTP
// connections (ports 465/587), so nodemailer could never even reach
// Gmail's server (every send failed with a connection timeout before
// authentication was ever attempted). Resend's API runs over plain
// HTTPS, which isn't blocked, using native fetch — no new dependency.
//
// RESEND_API_KEY must be set in the environment. Until the sending
// domain below is a verified custom domain, Resend only allows
// delivery to the email address the Resend account itself was signed
// up with — fine for testing, but real users won't receive mail until
// a domain is verified.
const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_ADDRESS    = 'YankelPrep <onboarding@resend.dev>'

import dns from 'dns/promises'

// ── Check the email's domain actually accepts mail ────────────────
// Called at registration so password-reset email has somewhere real
// to land later. A pure DNS lookup, not SMTP — Render blocks outbound
// SMTP (see above), but DNS queries aren't affected. This confirms
// the domain has mail servers configured, which catches typo domains
// (gmial.com, yah00.com) and domains that don't exist at all. It
// can't confirm the specific mailbox/username exists — that needs
// either SMTP probing (blocked here) or a paid third-party
// verification API, neither of which this does.
export const domainAcceptsMail = async (email) => {
  const domain = email.split('@')[1]
  if (!domain) return false

  try {
    const mxRecords = await dns.resolveMx(domain)
    if (mxRecords.length > 0) return true
  } catch {
    // No MX records (or the lookup failed) — fall through to the
    // A-record fallback below before giving up on the domain.
  }

  // A domain with no MX record can still accept mail via its bare A
  // record, an older but valid setup — confirm the domain resolves
  // at all before rejecting it outright.
  try {
    await dns.resolve4(domain)
    return true
  } catch {
    return false
  }
}

// ── Damerau-Levenshtein distance ──────────────────────────────────
// Counts insertions, deletions, substitutions, and adjacent-character
// transpositions as one edit each. The transposition case is what
// matters here: plain Levenshtein scores "gmial" vs "gmail" as 2 (two
// substitutions), which misses it at a threshold of 1 — this scores
// the same swap as 1, since it's a single transposed pair.
const editDistance = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) d[i][0] = i
  for (let j = 0; j <= b.length; j++) d[0][j] = j

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(
        d[i - 1][j] + 1,       // deletion
        d[i][j - 1] + 1,       // insertion
        d[i - 1][j - 1] + cost, // substitution
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1) // transposition
      }
    }
  }
  return d[a.length][b.length]
}

// Providers typo-squatters most often register look-alike domains
// for — those domains frequently DO have real MX records (set up
// deliberately to catch misdirected mail), so domainAcceptsMail alone
// lets them through. This catches the near-miss before that check runs.
const COMMON_EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com',
  'aol.com', 'live.com', 'msn.com', 'protonmail.com', 'yandex.com',
]

// ── Catch a one-edit typo of a well-known provider ────────────────
// Returns the likely-intended domain (e.g. "gmail.com") if the
// submitted domain is a single edit away from one, or null if it's
// an exact match or not close to any of them.
export const findDomainTypo = (email) => {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return null
  if (COMMON_EMAIL_DOMAINS.includes(domain)) return null

  for (const known of COMMON_EMAIL_DOMAINS) {
    if (editDistance(domain, known) === 1) return known
  }
  return null
}

// ── Send the password-reset email ───────────────────────────────
// Called by forgotPassword in auth.controller.js. resetUrl already
// contains the raw (unhashed) token as a query param.
export const sendPasswordResetEmail = async (to, resetUrl) => {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    FROM_ADDRESS,
      to,
      subject: 'Reset your YankelPrep password',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #EA580C;">Reset your password</h2>
          <p>We received a request to reset your YankelPrep password. This link expires in 30 minutes.</p>
          <p style="margin: 24px 0;">
            <a href="${resetUrl}" style="background: #EA580C; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">
              Reset password
            </a>
          </p>
          <p style="color: #64748B; font-size: 13px;">
            If you didn't request this, you can safely ignore this email — your password won't change.
          </p>
        </div>
      `,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Resend API error (${response.status}): ${body}`)
  }
}
