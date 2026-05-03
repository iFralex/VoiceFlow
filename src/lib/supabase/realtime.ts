/**
 * Supabase Realtime subscription helpers for the dashboard live view (plan 12).
 *
 * The `calls` and `campaigns` tables are added to the `supabase_realtime`
 * publication via migration 0005_realtime_publication.sql.
 *
 * Usage (populated in plan 12):
 *
 * ```ts
 * import { subscribeToCalls, subscribeToCampaigns } from '@/lib/supabase/realtime';
 *
 * const unsub = subscribeToCalls(supabase, orgId, (payload) => {
 *   // payload.eventType: 'INSERT' | 'UPDATE' | 'DELETE'
 *   // payload.new: Call (on INSERT/UPDATE)
 *   // payload.old: Partial<Call> (on UPDATE/DELETE)
 * });
 *
 * // Clean up on unmount:
 * unsub();
 * ```
 *
 * RLS note: Realtime respects row-level security. The client must be
 * authenticated (JWT with `sub` = user UUID) and the middleware must set
 * `app.current_org_id` via the Realtime channel params, or the subscription
 * must use a server-side component with the service role client for
 * organisation-scoped broadcasting.
 */

// Minimal Supabase client interface used by this stub.
// Replaced with full @supabase/supabase-js types when that package is added in plan 12.
export interface RealtimeChannelLike {
  on(
    event: string,
    opts: Record<string, unknown>,
    handler: (payload: unknown) => void,
  ): this;
  subscribe(): this;
}

export interface SupabaseClientLike {
  channel(name: string): RealtimeChannelLike;
  removeChannel(channel: RealtimeChannelLike): Promise<unknown>;
}

export type RealtimePayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, unknown>;
  old: Record<string, unknown>;
  schema: string;
  table: string;
  commit_timestamp: string;
};

function subscribeToTable(
  supabase: SupabaseClientLike,
  table: string,
  orgId: string,
  onPayload: (payload: RealtimePayload) => void,
): () => void {
  const channel = supabase
    .channel(`${table}:org:${orgId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        filter: `org_id=eq.${orgId}`,
      },
      (payload) => {
        onPayload(payload as RealtimePayload);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

/**
 * Subscribe to all changes on the `calls` table for a given org.
 *
 * Returns a cleanup function that removes the channel subscription.
 *
 * NOTE: Full implementation in plan 12. This stub establishes the API shape
 * so downstream code can import and type-check against it now.
 */
export function subscribeToCalls(
  supabase: SupabaseClientLike,
  orgId: string,
  onPayload: (payload: RealtimePayload) => void,
): () => void {
  return subscribeToTable(supabase, 'calls', orgId, onPayload);
}

/**
 * Subscribe to all changes on the `campaigns` table for a given org.
 *
 * Returns a cleanup function that removes the channel subscription.
 *
 * NOTE: Full implementation in plan 12. This stub establishes the API shape
 * so downstream code can import and type-check against it now.
 */
export function subscribeToCampaigns(
  supabase: SupabaseClientLike,
  orgId: string,
  onPayload: (payload: RealtimePayload) => void,
): () => void {
  return subscribeToTable(supabase, 'campaigns', orgId, onPayload);
}
