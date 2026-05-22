import { createClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';

type SupabaseAdminClient = ReturnType<typeof createClient>;

let _instance: SupabaseAdminClient | undefined;

function getInstance(): SupabaseAdminClient {
  _instance ??= createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _instance;
}

/**
 * Supabase admin client using the service role key.
 * Bypasses Row Level Security — only use in trusted server-only contexts
 * (auth triggers, user management, support operations).
 *
 * Lazy proxy: the real client is created on first property access so that
 * module-level imports do not throw during Next.js build when env vars are
 * not yet available.
 *
 * NEVER expose this client to the browser.
 */
export const supabaseAdmin: SupabaseAdminClient = new Proxy({} as SupabaseAdminClient, {
  get(_, prop: string | symbol) {
    const instance = getInstance();
    const val = instance[prop as keyof SupabaseAdminClient];
    return typeof val === 'function' ? (val as (...a: unknown[]) => unknown).bind(instance) : val;
  },
});
