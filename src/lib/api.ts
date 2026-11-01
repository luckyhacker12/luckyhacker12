/**
 * Thin fetch wrapper around the Express API.
 *
 * Every request carries the Supabase access token of the signed-in user; the
 * server re-derives the caller's role from the database on every request, so the
 * client never has to be trusted.
 */

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

type TokenGetter = () => Promise<string | null>

let tokenGetter: TokenGetter = async () => null

export function setTokenGetter(fn: TokenGetter) {
  tokenGetter = fn
}

/** Fired when the API rejects the session so the auth layer can sign out. */
export const UNAUTHORIZED_EVENT = 'callpro:unauthorized'

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await tokenGetter()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  let res: Response
  try {
    res = await fetch(`/api${path}`, { ...init, headers })
  } catch {
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Check your connection.')
  }

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
    throw new ApiError(401, 'unauthorized', 'Your session has expired. Please sign in again.')
  }

  const isJson = (res.headers.get('content-type') || '').includes('application/json')
  const payload = isJson ? await res.json().catch(() => null) : await res.text()

  if (!res.ok) {
    const body = (payload ?? {}) as { error?: string; message?: string; details?: unknown }
    throw new ApiError(
      res.status,
      body.error || 'request_failed',
      body.message || `Request failed (${res.status})`,
      body.details,
    )
  }

  return payload as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const out = search.toString()
  return out ? `?${out}` : ''
}

/** Downloads an authenticated CSV endpoint as a file. */
export async function downloadCsv(path: string, filename: string): Promise<void> {
  const token = await tokenGetter()
  const res = await fetch(`/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
    let message = `Export failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.message) message = body.message
    } catch {
      /* response was not JSON */
    }
    throw new ApiError(res.status, 'export_failed', message)
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Something went wrong'
}
