/**
 * CALLPRO CRM - HTTP server.
 *
 * Responsibilities:
 *  - serve the built React SPA;
 *  - expose /api/config so the browser can create its own Supabase client at
 *    runtime (no keys are baked into the bundle);
 *  - mount the authenticated API. Every /api route below /api/config and
 *    /api/health requires a verified Supabase access token.
 */

import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { publicConfig, hasSupabase } from './lib/supabase.mjs'
import { requireUser, requireAdmin } from './lib/auth.mjs'
import { HttpError } from './lib/errors.mjs'
import { sharedRouter } from './routes/shared.mjs'
import { adminRouter } from './routes/admin.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const distDir = path.join(projectRoot, 'dist')

const app = express()
app.disable('x-powered-by')
// Required so req.ip / rate-limiting proxies behave behind the platform router.
app.set('trust proxy', 1)

app.use(express.json({ limit: '2mb' }))

/* -------------------------------------------------------------------------- */
/* security headers                                                           */
/* -------------------------------------------------------------------------- */

app.use((req, res, next) => {
  const supabaseOrigin = (() => {
    const cfg = publicConfig()
    if (!cfg.supabaseUrl) return ''
    try {
      const url = new URL(cfg.supabaseUrl)
      return `${url.origin} ${url.origin.replace(/^https/, 'wss')}`
    } catch {
      return ''
    }
  })()

  const csp = [
    "default-src 'self'",
    // Vite emits same-origin modules; no third-party script is loaded.
    "script-src 'self'",
    // Inline styles are used for status colours and bar widths.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    // The SPA talks to this origin and to Supabase (REST + realtime websocket).
    `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ''}`,
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ')

  res.setHeader('Content-Security-Policy', csp)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  next()
})

/* -------------------------------------------------------------------------- */
/* public endpoints                                                           */
/* -------------------------------------------------------------------------- */

// Runtime configuration for the browser. Contains only the public anon key.
app.get('/api/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(publicConfig())
})

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    configured: hasSupabase,
    uptime: Math.round(process.uptime()),
    time: new Date().toISOString(),
  })
})

/* -------------------------------------------------------------------------- */
/* authenticated endpoints                                                    */
/* -------------------------------------------------------------------------- */

// Who am I? The role comes from the database, never from the client.
app.get('/api/me', requireUser, (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ profile: req.profile })
})

app.use('/api', requireUser, sharedRouter)
app.use('/api/admin', requireUser, requireAdmin, adminRouter)

// Unknown API route: JSON 404 (never the SPA shell).
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Unknown API endpoint' })
})

/* -------------------------------------------------------------------------- */
/* static SPA                                                                 */
/* -------------------------------------------------------------------------- */

if (fs.existsSync(distDir)) {
  app.use(
    express.static(distDir, {
      index: false,
      setHeaders: (res, filePath) => {
        // Hashed assets are immutable; the shell must always revalidate.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        }
      },
    }),
  )

  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(distDir, 'index.html'))
  })
} else {
  app.get('*', (_req, res) => {
    res.status(503).type('text/plain').send(
      'CALLPRO CRM API is running, but the web bundle has not been built yet.\n' +
        'Run "npm run build" and restart, or use "npm run dev" for development.\n',
    )
  })
}

/* -------------------------------------------------------------------------- */
/* error handling                                                            */
/* -------------------------------------------------------------------------- */

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err instanceof HttpError ? err.status : 500
  const body = {
    error: err instanceof HttpError ? err.code : 'server_error',
    message:
      err instanceof HttpError
        ? err.message
        : 'Unexpected server error. Please try again.',
  }
  if (err instanceof HttpError && err.details) body.details = err.details
  if (!(err instanceof HttpError)) console.error('[api] unhandled error:', err)

  if (res.headersSent) return
  res.status(status).json(body)
})

const port = Number(process.env.PORT) || 3000
app.listen(port, '0.0.0.0', () => {
  console.log(`[callpro] listening on http://0.0.0.0:${port}`)
  if (!hasSupabase) {
    console.warn(
      '[callpro] SUPABASE_URL / SUPABASE_ANON_KEY are not set - the API will answer 503 ' +
        'until they are configured (see .env.example).',
    )
  }
})
