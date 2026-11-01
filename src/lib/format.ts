/** Small date/number/text helpers used across the UI. */

export function fmtDate(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtTime(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function fmtDateTime(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return `${fmtDate(value)}, ${fmtTime(value)}`
}

/** "in 2 hours", "3 days ago" - used for follow-up badges. */
export function relative(value?: string | null): string {
  if (!value) return '—'
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = then - Date.now()
  const abs = Math.abs(diff)
  const mins = Math.round(abs / 60000)
  const unit =
    mins < 60
      ? `${mins} min`
      : mins < 1440
        ? `${Math.round(mins / 60)} h`
        : `${Math.round(mins / 1440)} d`
  return diff >= 0 ? `in ${unit}` : `${unit} ago`
}

export function isOverdue(value?: string | null): boolean {
  if (!value) return false
  return new Date(value).getTime() < Date.now()
}

/** `datetime-local` inputs need a local, timezone-corrected value. */
export function toLocalInput(value?: string | Date | null): string {
  const d = value ? new Date(value) : new Date()
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function initials(name?: string | null): string {
  const source = (name || '?').trim()
  const parts = source.split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

export function fmtDuration(seconds?: number | null): string {
  const s = Math.max(0, Math.round(seconds ?? 0))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function statusClass(status: string): string {
  switch (status) {
    case 'New':
      return 'st-new'
    case 'Not Answered':
      return 'st-noanswer'
    case 'Interested':
      return 'st-interested'
    case 'Not Interested':
      return 'st-notinterested'
    case 'Callback':
      return 'st-callback'
    case 'Follow-up':
      return 'st-followup'
    case 'Converted':
      return 'st-converted'
    case 'Invalid':
      return 'st-invalid'
    default:
      return 'st-default'
  }
}
