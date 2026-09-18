import { NextRequest, NextResponse } from 'next/server'
import { lease, signed } from '@/lib/lease'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The only endpoint that matters: an installation presents its key and gets
 * back the credentials it runs on, or a refusal.
 *
 * Refusals are signed too. An installation that is told "revoked" must be able
 * to tell that from a forged refusal by someone trying to take a competitor's
 * platform down, and from the network simply being broken.
 */
export async function POST(request: NextRequest) {
  let body: { key?: string; installationId?: string; host?: string; version?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const key = String(body.key || '').trim()
  const installationId = String(body.installationId || '').trim()
  const host = String(body.host || '').trim()

  if (!key || !installationId || !host) {
    return NextResponse.json({ error: 'key, installationId and host are required' }, { status: 400 })
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip') || undefined

  let result
  try {
    result = await lease({ key, installationId, host, version: body.version, ip })
  } catch (e) {
    // Our fault, not theirs: say so with a 5xx, which the installation treats as
    // silence and rides out on its grace period rather than shutting down.
    console.error('[lease] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Licence service error' }, { status: 503 })
  }

  if (!result.ok) {
    const { payload, signature } = signed({ ok: false, reason: result.reason, message: result.message })
    return NextResponse.json({ payload, signature }, { status: 403 })
  }

  const { secrets, ...rest } = result
  const { payload, signature } = signed(rest)
  return NextResponse.json({ payload, signature, secrets }, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}
