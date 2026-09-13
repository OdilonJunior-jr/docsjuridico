import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config'
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
  )
}
