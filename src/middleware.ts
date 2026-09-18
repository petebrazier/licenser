import { NextResponse, type NextRequest } from 'next/server'

/**
 * The admin pages are the kill switch, so they get a lock of their own rather
 * than relying on the URL being hard to guess. The API under /api/v1 is public
 * by necessity — it authenticates with the licence key in the body.
 */
export function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    const expected = process.env.ADMIN_PASSWORD
    if (!expected) {
      return new NextResponse('ADMIN_PASSWORD is not set on this service.', { status: 500 })
    }
    const header = request.headers.get('authorization') || ''
    const [scheme, encoded] = header.split(' ')
    const given = scheme === 'Basic' && encoded
      ? Buffer.from(encoded, 'base64').toString('utf8').split(':').slice(1).join(':')
      : ''
    if (given !== expected) {
      return new NextResponse('Authentication required', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="Bonza licences"' },
      })
    }
  }
  return NextResponse.next()
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
