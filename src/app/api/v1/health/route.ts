import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Which configuration this deployment can actually see.
 *
 * Names and lengths only — never a value. "Set the variables" and "the
 * variables are set" can both be true while the service still fails, and
 * without this there is no way to tell which of the two you are looking at
 * from outside the Vercel account that owns it.
 */
export async function GET() {
  const names = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ADMIN_PASSWORD',
    'SECRET_ENCRYPTION_KEY',
    'LEASE_SIGNING_KEY',
  ]

  const env: Record<string, string> = {}
  for (const name of names) {
    const value = process.env[name]
    env[name] = value === undefined ? 'missing'
      : value === '' ? 'empty'
      : `set (${value.length} chars)`
  }

  // The commonest cause of "I added them and nothing changed" is a deployment
  // older than the variables, so say which build this is.
  return NextResponse.json({
    env,
    deployment: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? 'unknown',
      environment: process.env.VERCEL_ENV ?? 'unknown',
      region: process.env.VERCEL_REGION ?? 'unknown',
    },
  }, { headers: { 'Cache-Control': 'no-store' } })
}
