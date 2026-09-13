import type { NextConfig } from 'next'

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
]

const nextConfig: NextConfig = {
  // Vercel already packages Next.js itself. Next 16.3 + standalone currently
  // conflicts with Vercel's post-build tracing (.nft.json). Keep standalone
  // only for Docker/self-hosted builds.
  output: process.env.VERCEL ? undefined : 'standalone',
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
