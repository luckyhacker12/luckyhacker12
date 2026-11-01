/**
 * Supabase browser client.
 *
 * The URL and anon key are fetched from GET /api/config at runtime, so the
 * published image contains no credentials and the app can be pointed at a
 * project without rebuilding. Only the public anon key is sent to the browser;
 * the service-role key never leaves the server.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface RuntimeConfig {
  configured: boolean
  supabaseUrl: string | null
  supabaseAnonKey: string | null
}

let configPromise: Promise<RuntimeConfig> | null = null
let client: SupabaseClient | null = null
let clientPromise: Promise<SupabaseClient | null> | null = null

export function loadConfig(): Promise<RuntimeConfig> {
  if (!configPromise) {
    configPromise = fetch('/api/config')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Configuration request failed (${res.status})`)
        const data = (await res.json()) as RuntimeConfig
        return {
          configured: Boolean(data.configured && data.supabaseUrl && data.supabaseAnonKey),
          supabaseUrl: data.supabaseUrl,
          supabaseAnonKey: data.supabaseAnonKey,
        }
      })
      .catch(() => {
        configPromise = null
        throw new Error('Cannot load runtime configuration from the server.')
      })
  }
  return configPromise
}

/** Returns the shared client, or null when the server has no Supabase config. */
export function getSupabase(): Promise<SupabaseClient | null> {
  if (!clientPromise) {
    clientPromise = loadConfig().then((cfg) => {
      if (!cfg.configured || !cfg.supabaseUrl || !cfg.supabaseAnonKey) return null
      if (!client) {
        client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
            storageKey: 'callpro-auth',
          },
        })
      }
      return client
    })
  }
  return clientPromise
}
