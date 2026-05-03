import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  subscribeToCalls,
  subscribeToCampaigns,
  type RealtimePayload,
  type SupabaseClientLike,
  type RealtimeChannelLike,
} from './realtime';

// ============================================================
// Migration file tests
// ============================================================

const migrationPath = join(
  process.cwd(),
  'drizzle/migrations/0005_realtime_publication.sql',
);

function getMigration(): string {
  return readFileSync(migrationPath, 'utf-8');
}

describe('migration 0005_realtime_publication.sql', () => {
  it('file exists and is non-empty', () => {
    expect(getMigration().length).toBeGreaterThan(200);
  });

  it('adds calls table to supabase_realtime publication', () => {
    expect(getMigration()).toContain('ADD TABLE calls');
  });

  it('adds campaigns table to supabase_realtime publication', () => {
    expect(getMigration()).toContain('ADD TABLE campaigns');
  });

  it('targets supabase_realtime publication (does not CREATE a new one)', () => {
    const content = getMigration();
    expect(content).toContain('supabase_realtime');
    // Ensure there is no uncommented CREATE PUBLICATION statement
    const uncommentedCreate = content
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(uncommentedCreate).not.toContain('CREATE PUBLICATION');
  });

  it('includes ALTER PUBLICATION statements for both tables', () => {
    const content = getMigration();
    const alterCount = (content.match(/ALTER PUBLICATION/g) ?? []).length;
    expect(alterCount).toBeGreaterThanOrEqual(2);
  });

  it('documents HOW TO APPLY the migration', () => {
    expect(getMigration()).toContain('HOW TO APPLY');
  });

  it('includes a verification query referencing pg_publication_tables', () => {
    expect(getMigration()).toContain('pg_publication_tables');
  });

  it('references both calls and campaigns in the verification section', () => {
    const content = getMigration();
    expect(content).toContain("'calls'");
    expect(content).toContain("'campaigns'");
  });
});

// ============================================================
// helpers
// ============================================================

function makeMockChannel(): RealtimeChannelLike & {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
} {
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);
  return channel;
}

function makeMockSupabase(): {
  supabase: SupabaseClientLike & {
    channel: ReturnType<typeof vi.fn>;
    removeChannel: ReturnType<typeof vi.fn>;
  };
  channel: ReturnType<typeof makeMockChannel>;
} {
  const channel = makeMockChannel();
  const removeChannel = vi.fn().mockResolvedValue(undefined);
  const supabase = {
    channel: vi.fn().mockReturnValue(channel),
    removeChannel,
  };
  return { supabase, channel };
}

// ============================================================
// subscribeToCalls unit tests
// ============================================================

describe('subscribeToCalls', () => {
  it('creates a channel with the org-scoped channel name', () => {
    const { supabase } = makeMockSupabase();
    subscribeToCalls(supabase, 'org-123', vi.fn());
    expect(supabase.channel).toHaveBeenCalledWith('calls:org:org-123');
  });

  it('subscribes to postgres_changes on the calls table', () => {
    const { supabase, channel } = makeMockSupabase();
    subscribeToCalls(supabase, 'org-123', vi.fn());
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({ table: 'calls', schema: 'public' }),
      expect.any(Function),
    );
  });

  it('applies an org_id filter so only org rows are received', () => {
    const { supabase, channel } = makeMockSupabase();
    subscribeToCalls(supabase, 'org-123', vi.fn());
    const call = channel.on.mock.calls[0];
    expect(call).toBeDefined();
    const options = call![1] as { filter: string };
    expect(options.filter).toBe('org_id=eq.org-123');
  });

  it('subscribes to all event types (*)', () => {
    const { supabase, channel } = makeMockSupabase();
    subscribeToCalls(supabase, 'org-123', vi.fn());
    const call = channel.on.mock.calls[0];
    expect(call).toBeDefined();
    const options = call![1] as { event: string };
    expect(options.event).toBe('*');
  });

  it('calls subscribe() to activate the channel', () => {
    const { supabase, channel } = makeMockSupabase();
    subscribeToCalls(supabase, 'org-123', vi.fn());
    expect(channel.subscribe).toHaveBeenCalledOnce();
  });

  it('returns a cleanup function that removes the channel', () => {
    const { supabase, channel } = makeMockSupabase();
    const unsub = subscribeToCalls(supabase, 'org-123', vi.fn());
    unsub();
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });

  it('forwards the payload to the callback', () => {
    const { supabase, channel } = makeMockSupabase();
    const onPayload = vi.fn();
    subscribeToCalls(supabase, 'org-123', onPayload);
    const call = channel.on.mock.calls[0];
    expect(call).toBeDefined();
    const handler = call![2] as (p: RealtimePayload) => void;
    const mockPayload: RealtimePayload = {
      eventType: 'INSERT',
      new: { id: 'call-1' },
      old: {},
      schema: 'public',
      table: 'calls',
      commit_timestamp: '2026-01-01T00:00:00Z',
    };
    handler(mockPayload);
    expect(onPayload).toHaveBeenCalledWith(mockPayload);
  });
});

// ============================================================
// subscribeToCampaigns unit tests
// ============================================================

describe('subscribeToCampaigns', () => {
  it('creates a channel with the org-scoped channel name', () => {
    const { supabase } = makeMockSupabase();
    subscribeToCampaigns(supabase, 'org-456', vi.fn());
    expect(supabase.channel).toHaveBeenCalledWith('campaigns:org:org-456');
  });

  it('subscribes to postgres_changes on the campaigns table', () => {
    const { supabase, channel } = makeMockSupabase();
    subscribeToCampaigns(supabase, 'org-456', vi.fn());
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({ table: 'campaigns', schema: 'public' }),
      expect.any(Function),
    );
  });

  it('applies an org_id filter', () => {
    const { supabase, channel } = makeMockSupabase();
    subscribeToCampaigns(supabase, 'org-456', vi.fn());
    const call = channel.on.mock.calls[0];
    expect(call).toBeDefined();
    const options = call![1] as { filter: string };
    expect(options.filter).toBe('org_id=eq.org-456');
  });

  it('subscribes to all event types (*)', () => {
    const { supabase, channel } = makeMockSupabase();
    subscribeToCampaigns(supabase, 'org-456', vi.fn());
    const call = channel.on.mock.calls[0];
    expect(call).toBeDefined();
    const options = call![1] as { event: string };
    expect(options.event).toBe('*');
  });

  it('calls subscribe() to activate the channel', () => {
    const { supabase, channel } = makeMockSupabase();
    subscribeToCampaigns(supabase, 'org-456', vi.fn());
    expect(channel.subscribe).toHaveBeenCalledOnce();
  });

  it('returns a cleanup function that removes the channel', () => {
    const { supabase, channel } = makeMockSupabase();
    const unsub = subscribeToCampaigns(supabase, 'org-456', vi.fn());
    unsub();
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });

  it('forwards the payload to the callback', () => {
    const { supabase, channel } = makeMockSupabase();
    const onPayload = vi.fn();
    subscribeToCampaigns(supabase, 'org-456', onPayload);
    const call = channel.on.mock.calls[0];
    expect(call).toBeDefined();
    const handler = call![2] as (p: RealtimePayload) => void;
    const mockPayload: RealtimePayload = {
      eventType: 'UPDATE',
      new: { id: 'campaign-1', status: 'running' },
      old: { status: 'scheduled' },
      schema: 'public',
      table: 'campaigns',
      commit_timestamp: '2026-01-01T00:00:00Z',
    };
    handler(mockPayload);
    expect(onPayload).toHaveBeenCalledWith(mockPayload);
  });
});
