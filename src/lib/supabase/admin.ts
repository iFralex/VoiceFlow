import { createClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';

/**
 * Supabase admin client using the service role key.
 * Bypasses Row Level Security — only use in trusted server-only contexts
 * (auth triggers, user management, support operations).
 *
 * NEVER expose this client to the browser.
 */
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
