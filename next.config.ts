import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * Every council URL resolves to one statically generated room shell.
   *
   * The visible URL remains /room/CODE, so old invite links keep working. The
   * destination is a CDN asset, not a per-room serverless render, removing
   * function cold starts from the critical open/join path.
   */
  async rewrites() {
    return [
      {
        source: '/room/:code([A-Za-z0-9]{4,8})',
        destination: '/room?code=:code',
      },
    ]
  },

  /** Next already handles immutable build assets; only tune our own icon. */
  async headers() {
    return [
      {
        source: '/',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=604800',
          },
        ],
      },
      {
        source: '/room',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=604800',
          },
        ],
      },
      {
        source: '/room/:code([A-Za-z0-9]{4,8})',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=604800',
          },
        ],
      },
      {
        source: '/icon.svg',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}

export default nextConfig
