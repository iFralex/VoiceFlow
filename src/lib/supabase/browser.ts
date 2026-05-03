'use client';

import { createBrowserClient } from '@supabase/ssr';

import { env } from '@/lib/env';

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Returns a singleton Supabase browser client for use in Client Components.
 * Suitable for realtime subscriptions and client-side auth state.
 *
 * Only call this from Client Components (files with 'use client').
 */
export function getSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  }
  return browserClient;
}
