export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    if (details) this.details = details
  }
}

export const badRequest = (message, details) =>
  new HttpError(400, 'bad_request', message, details)

export const unauthorized = (message = 'Authentication required') =>
  new HttpError(401, 'unauthorized', message)

export const forbidden = (message = 'You do not have access to this resource') =>
  new HttpError(403, 'forbidden', message)

export const notFound = (message = 'Not found') =>
  new HttpError(404, 'not_found', message)

export const notConfigured = () =>
  new HttpError(
    503,
    'crm_not_configured',
    'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY on the server.',
  )

/** Wraps an async route handler so rejected promises reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next)
