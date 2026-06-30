import { createClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config';

export function createSupabaseAdmin(config: AppConfig) {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export type SupabaseAdminClient = ReturnType<typeof createSupabaseAdmin>;
