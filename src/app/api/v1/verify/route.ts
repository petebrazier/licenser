import { NextRequest, NextResponse } from 'next/server'
import { lease, signed } from '@/lib/lease'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Status without credentials — for a health page or a support call, where
 * handing back live API keys would be the wrong thing entirely.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, string>
  const key = String(body.key || '').trim()
  const installationId = String(body.installationId || 'verify').trim()
  const host = String(body.host || '').trim()
  if (!key || !host) return NextResponse.json({ error: 'key and host are required' }, { status: 400 })

  const result = await lease({ key, installationId, host })
  if (!result.ok) {
    const { payload, signature } = signed({ ok: false, reason: result.reason, message: result.message })
    return NextResponse.json({ payload, signature }, { status: 403 })
  }
  const { secrets: _secrets, ...rest } = result
  const { payload, signature } = signed(rest)
  return NextResponse.json({ payload, signature })
}
