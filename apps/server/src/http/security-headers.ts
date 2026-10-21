import type { FastifyInstance } from 'fastify'
import type { Config } from '../config'

/** Browser hardening for everything the server sends: the built web app, the API and files. */
export function installSecurityHeaders(app: FastifyInstance, config: Config): void {
  const production = config.NODE_ENV === 'production'
  const publicOrigin = new URL(config.PUBLIC_URL)
  const wsOrigin = `${publicOrigin.protocol === 'https:' ? 'wss:' : 'ws:'}//${publicOrigin.host}`
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    // React style attributes and the Google Fonts stylesheet.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    // QR codes are data: URLs; attachment previews may be blob: URLs.
    "img-src 'self' data: blob:",
    `connect-src 'self' ${wsOrigin}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')

  app.addHook('onSend', async (_request, reply) => {
    // A route may set a stricter policy itself (file downloads are sandboxed).
    if (!reply.hasHeader('Content-Security-Policy')) reply.header('Content-Security-Policy', csp)
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Referrer-Policy', 'same-origin')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
    reply.header('Cross-Origin-Opener-Policy', 'same-origin')
    if (production) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  })
}
