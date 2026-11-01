import type { ReactNode } from 'react'

/** Minimal inline icon set (stroke-based, inherits currentColor). */
const PATHS: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" />
      <rect x="3" y="15" width="7" height="6" rx="1.5" />
    </>
  ),
  leads: (
    <>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c0-3.1 2.5-5.2 5.5-5.2s5.5 2.1 5.5 5.2" />
      <path d="M16.5 6.2a3 3 0 0 1 0 5.6M18 19.8c0-2-.6-3.5-1.6-4.6" />
    </>
  ),
  phone: (
    <path d="M5 3.5h3l1.6 4-2 1.4a12 12 0 0 0 6.5 6.5l1.4-2 4 1.6v3a2 2 0 0 1-2.2 2A17.5 17.5 0 0 1 3 5.7 2 2 0 0 1 5 3.5Z" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  upload: <path d="M12 16V4m0 0L7 9m5-5 5 5M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />,
  download: <path d="M12 4v12m0 0 5-5m-5 5-5-5M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  logout: <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M10 8l-4 4 4 4M6 12h9" />,
  back: <path d="M11 6l-6 6 6 6M5 12h14" />,
  check: <path d="M5 13l4 4L19 7" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v5M12 16h.01" />
    </>
  ),
  building: (
    <>
      <rect x="4" y="3.5" width="10" height="17" rx="1.5" />
      <path d="M14 9h5.5v11.5H14M7.5 7.5h3M7.5 11h3M7.5 14.5h3" />
    </>
  ),
  spark: <path d="M12 3l2.2 5.6L20 11l-5.8 2.4L12 19l-2.2-5.6L4 11l5.8-2.4L12 3Z" />,
}

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: keyof typeof PATHS | string
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      focusable="false"
    >
      {PATHS[name] ?? PATHS.spark}
    </svg>
  )
}
