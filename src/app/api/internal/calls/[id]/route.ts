import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getAuthContext, hasCapability } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/context';
import { calls } from '@/lib/db/schema';

/**
 * GET /api/internal/calls/:id
 *
 * Returns the status, outcome, recording_path, and transcript_path for a
 * single call owned by the authenticated org. Gated by `org.manage` (owner).
 *
 * Used by the E2E staging test to poll call completion.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let orgId: string;
  let role: string;
  try {
    const ctx = await getAuthContext();
    orgId = ctx.orgId;
    role = ctx.role;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!hasCapability(role as Parameters<typeof hasCapability>[0], 'org.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;

  const [call] = await withOrgContext(orgId, (tx) =>
    tx
      .select({
        id: calls.id,
        status: calls.status,
        outcome: calls.outcome,
        outcome_confidence: calls.outcome_confidence,
        recording_path: calls.recording_path,
        transcript_path: calls.transcript_path,
        transferred_to_agent: calls.transferred_to_agent,
        error_code: calls.error_code,
        // Plan 10 task 14: surface the CLI used for this dispatch so the
        // future call detail page (plan 12 task 7) can render a "CLI
        // utilizzato" column with the carrier tag.
        from_number: calls.from_number,
        cli_provider: calls.cli_provider,
        started_at: calls.started_at,
        ended_at: calls.ended_at,
      })
      .from(calls)
      .where(eq(calls.id, id))
      .limit(1),
  );

  if (!call) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 });
  }

  return NextResponse.json(call);
}
