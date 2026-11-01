import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase, loadConfig, type RuntimeConfig } from '../lib/supabase'
import { api, ApiError, setTokenGetter, UNAUTHORIZED_EVENT } from '../lib/api'
import type { Profile, Role } from '../lib/types'

interface AuthValue {
  booting: boolean
  config: RuntimeConfig | null
  configError: string | null
  profile: Profile | null
  session: Session | null
  signIn: (email: string, password: string, portal: Role) => Promise<Profile>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

const PORTAL_MISMATCH: Record<Role, string> = {
  admin: 'This account is an employee account. Use the Employee sign-in tab.',
  employee: 'This account is an administrator account. Use the Administrator sign-in tab.',
}

function friendlyAuthError(message: string): string {
  const text = message.toLowerCase()
  if (text.includes('invalid login credentials')) return 'Incorrect email or password.'
  if (text.includes('email not confirmed')) return 'This email has not been confirmed yet.'
  if (text.includes('rate limit') || text.includes('too many'))
    return 'Too many attempts. Please wait a moment and try again.'
  if (text.includes('failed to fetch') || text.includes('network'))
    return 'Cannot reach Supabase. Check the project URL and your connection.'
  return message
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [booting, setBooting] = useState(true)
  const [config, setConfig] = useState<RuntimeConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [session, setSession] = useState<Session | null>(null)

  const clear = useCallback(() => {
    setProfile(null)
    setSession(null)
  }, [])

  const fetchProfile = useCallback(async (): Promise<Profile | null> => {
    try {
      const data = await api.get<{ profile: Profile }>('/me')
      setProfile(data.profile)
      return data.profile
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null
      throw err
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const boot = async () => {
      try {
        const cfg = await loadConfig()
        if (cancelled) return
        setConfig(cfg)
        if (!cfg.configured) {
          setBooting(false)
          return
        }

        const client = await getSupabase()
        if (!client || cancelled) {
          setBooting(false)
          return
        }

        setTokenGetter(async () => {
          const { data } = await client.auth.getSession()
          return data.session?.access_token ?? null
        })

        client.auth.onAuthStateChange((event, nextSession) => {
          if (event === 'SIGNED_OUT') clear()
          else if (nextSession) setSession(nextSession)
        })

        const { data } = await client.auth.getSession()
        if (cancelled) return
        if (!data.session) {
          setBooting(false)
          return
        }

        try {
          await fetchProfile()
          setSession(data.session)
        } catch {
          // A signed-in auth user with no CRM profile (or a deactivated one)
          // must not keep a usable session.
          await client.auth.signOut().catch(() => undefined)
          clear()
        }
      } catch (err) {
        if (!cancelled) setConfigError(err instanceof Error ? err.message : 'Configuration error')
      } finally {
        if (!cancelled) setBooting(false)
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [clear, fetchProfile])

  useEffect(() => {
    const onUnauthorized = () => {
      void getSupabase()
        .then((client) => client?.auth.signOut())
        .catch(() => undefined)
      clear()
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [clear])

  const signIn = useCallback(
    async (email: string, password: string, portal: Role): Promise<Profile> => {
      const client = await getSupabase()
      if (!client) throw new Error('Supabase is not configured on this server yet.')

      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (error) throw new Error(friendlyAuthError(error.message))

      setSession(data.session)

      let nextProfile: Profile
      try {
        const me = await api.get<{ profile: Profile }>('/me')
        nextProfile = me.profile
      } catch (err) {
        await client.auth.signOut().catch(() => undefined)
        clear()
        if (err instanceof ApiError && err.status === 403) throw new Error(err.message)
        if (err instanceof ApiError) throw new Error(err.message)
        throw new Error('Could not verify your CRM profile.')
      }

      if (nextProfile.role !== portal) {
        await client.auth.signOut().catch(() => undefined)
        clear()
        throw new Error(PORTAL_MISMATCH[portal])
      }

      setProfile(nextProfile)
      return nextProfile
    },
    [clear],
  )

  const signOut = useCallback(async () => {
    const client = await getSupabase()
    await client?.auth.signOut().catch(() => undefined)
    clear()
  }, [clear])

  const refreshProfile = useCallback(async () => {
    await fetchProfile().catch(() => undefined)
  }, [fetchProfile])

  const value = useMemo<AuthValue>(
    () => ({ booting, config, configError, profile, session, signIn, signOut, refreshProfile }),
    [booting, config, configError, profile, session, signIn, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
