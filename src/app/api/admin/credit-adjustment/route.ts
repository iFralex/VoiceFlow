import { timingSafeEqual } from 'crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { env } from '@/lib/env';
import { adjust } from '@/lib/services/credit';

const BodySchema = z.object({
  orgId: z.string().uuid(),
  deltaCents: z.number().int().min(-10_000_000).max(10_000_000),
  reason: z.string().min(1),
});

export async function POST(request: Request): Promise<Response> {
  const token = request.headers.get('x-admin-token');

  const isValid =
    token !== null &&
    token.length === env.INTERNAL_ADMIN_TOKEN.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(env.INTERNAL_ADMIN_TOKEN));

  if (!isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { orgId, deltaCents, reason } = parsed.data;

  try {
    await adjust(orgId, 'system', deltaCents, reason, { actorType: 'system' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
