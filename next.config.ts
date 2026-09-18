import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The whole service is request-time work against a database; nothing to prerender.
  output: 'standalone',
}

export default nextConfig
