import User from '../models/User.model.js'

// ── bootstrapAdmin ────────────────────────────────────────────
// Optional: if ADMIN_EMAIL and ADMIN_PASSWORD are set and no user
// with that email exists yet, create it as an admin. Runs once on
// every server startup — cheap, idempotent, silently does nothing
// if either env var is missing (opt-in feature).
//
// Useful for deployments like Render where you control env vars
// but may not have a quick shell into the database.
export const bootstrapAdmin = async () => {
  const { ADMIN_PASSWORD } = process.env
  // Same normalisation the User model applies on save, so the existence
  // check below matches an already-created admin.
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return

  const existing = await User.findOne({ email: ADMIN_EMAIL })
  if (existing) {
    console.log(`🔑 Bootstrap admin (${ADMIN_EMAIL}) already exists — skipping.`)
    return
  }

  await User.create({
    fullName: 'Admin',
    email:    ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    role:     'admin',
  })

  console.log(`🔑 Bootstrap admin created: ${ADMIN_EMAIL}`)
}
