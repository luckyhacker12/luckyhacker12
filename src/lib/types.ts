/** Shared types mirroring the database schema (supabase/migrations/001_schema.sql). */

export type Role = 'admin' | 'employee'

export const LEAD_STATUSES = [
  'New',
  'Not Answered',
  'Interested',
  'Not Interested',
  'Callback',
  'Follow-up',
  'Converted',
  'Invalid',
] as const

export type LeadStatus = (typeof LEAD_STATUSES)[number]

export const CALL_OUTCOMES = [
  'Answered',
  'No Answer',
  'Busy',
  'Voicemail',
  'Wrong Number',
  'Callback Requested',
] as const

export type CallOutcome = (typeof CALL_OUTCOMES)[number]

export type FollowUpStatus = 'pending' | 'done' | 'missed'
export type AttendanceStatus = 'present' | 'absent' | 'half-day' | 'leave'

export interface Profile {
  id: string
  email: string
  full_name: string
  phone?: string | null
  role: Role
  active: boolean
  created_at?: string
}

export interface Lead {
  id: string
  name: string
  phone: string
  email: string | null
  company: string | null
  city: string | null
  source: string
  status: LeadStatus
  assigned_to: string | null
  assignee_name?: string | null
  notes: string | null
  last_contacted_at: string | null
  created_by: string | null
  created_at: string
  updated_at?: string
}

export interface CallLog {
  id: string
  lead_id: string
  employee_id: string
  employee_name?: string | null
  outcome: string
  notes: string | null
  duration_seconds: number
  called_at: string
  lead?: { id: string; name: string; phone: string; company: string | null } | null
}

export interface FollowUp {
  id: string
  lead_id: string
  assigned_to: string | null
  assignee_name?: string | null
  due_at: string
  note: string | null
  status: FollowUpStatus
  completed_at: string | null
  created_by: string | null
  created_at: string
  lead?: { id: string; name: string; phone: string; company: string | null; status: LeadStatus } | null
  overdue?: boolean
}

export interface Attendance {
  id: string
  employee_id: string
  work_date: string
  check_in: string | null
  check_out: string | null
  status: AttendanceStatus
  notes: string | null
  created_at?: string
}

export interface Paged<T> {
  rows: T[]
  total: number
  page?: number
  pageSize?: number
}

export interface AdminStats {
  total_leads: number
  unassigned_leads: number
  converted_leads: number
  total_employees: number
  active_employees: number
  total_calls: number
  calls_today: number
  calls_week: number
  pending_followups: number
  overdue_followups: number
  due_today_followups: number
  present_today: number
  status_counts: Record<string, number>
  employees: EmployeeStat[]
}

export interface EmployeeStat extends Profile {
  leads_assigned?: number
  open_leads?: number
  converted_leads?: number
  calls_today?: number
  calls_week?: number
  pending_followups?: number
}

export interface EmployeeStats {
  my_leads: number
  new_leads: number
  interested: number
  converted: number
  calls_today: number
  calls_total: number
  due_today: number
  overdue: number
  status_counts: Record<string, number>
}

export interface LeadDetailPayload {
  lead: Lead
  calls: CallLog[]
  follow_ups: FollowUp[]
}
