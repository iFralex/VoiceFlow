import { timingSafeEqual } from 'crypto';

import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import {
  aggregateActiveCampaigns,
  aggregateOneCampaign,
} from '@/lib/services/campaign-aggregation';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function authorize(request: Request): boolean {
  const secret = env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  const expected = `Bearer ${secret}`;
  if (!auth || auth.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
}

// ---------------------------------------------------------------------------
// Compatibility re-exports (tests reach these names through this module path)
// ---------------------------------------------------------------------------

export const aggregateCampaignStats = aggregateActiveCampaigns;
export { aggregateOneCampaign };

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await aggregateActiveCampaigns();

  return NextResponse.json({ ok: true, ...result });
}

// Disable static caching — this must always run fresh
export const dynamic = 'force-dynamic';
