'use server';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { getAuthContext, requireCapability } from '@/lib/auth/context';
import { recordAudit } from '@/lib/db/audit';
import { withOrgContext } from '@/lib/db/context';
import { calls } from '@/lib/db/schema';
import { sendEmail } from '@/lib/email';
import { env } from '@/lib/env';
import { refundCall } from '@/lib/services/credit';
import type { ActionResult } from '@/lib/utils/action-toast';

const refundCallSchema = z.object({
  callId: z.string().uuid('invalid_call_id'),
  reason: z.string().trim().min(3, 'reason_required').max(500, 'reason_too_long'),
});

/**
 * Issues a credit refund for a single call.
 *
 * Gated by `billing.topup` (the same capability required to spend credits;
 * `viewer`/`operator` are explicitly excluded). Idempotent on call id —
 * `refundCall` uses an ON CONFLICT clause keyed on (org, refund, call).
 */
export async function refundCallAction(
  input: z.infer<typeof refundCallSchema>,
): Promise<ActionResult> {
  const parsed = refundCallSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'invalid_input';
    return { ok: false, message };
  }

  const { callId, reason } = parsed.data;

  const { orgId } = await getAuthContext();
  await requireCapability('billing.topup');

  const [call] = await withOrgContext(orgId, (tx) =>
    tx
      .select({ cost_cents: calls.cost_cents, status: calls.status })
      .from(calls)
      .where(and(eq(calls.id, callId), eq(calls.org_id, orgId)))
      .limit(1),
  );

  if (!call) return { ok: false, message: 'call_not_found' };
  const cost = call.cost_cents ?? 0;
  if (cost <= 0) return { ok: false, message: 'call_not_refundable' };

  await refundCall(orgId, callId, cost, reason);

  return { ok: true };
}

const reportCallIssueSchema = z.object({
  callId: z.string().uuid('invalid_call_id'),
  message: z.string().trim().min(3, 'message_required').max(2000, 'message_too_long'),
});

/**
 * Sends a support email about a problematic call. The actor's user id, org id,
 * and the call id are stamped into the email body so support can pull the call
 * record on their side. The submission is also recorded in the audit log.
 *
 * No capability gate beyond `campaigns.view` — any seat that can view a call
 * should be able to flag it. We rely on `getAuthContext` throwing for
 * unauthenticated requests.
 */
export async function reportCallIssueAction(
  input: z.infer<typeof reportCallIssueSchema>,
): Promise<ActionResult> {
  const parsed = reportCallIssueSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'invalid_input';
    return { ok: false, message };
  }

  const { callId, message } = parsed.data;
  const { userId, orgId } = await getAuthContext();
  await requireCapability('campaigns.view');

  const [call] = await withOrgContext(orgId, (tx) =>
    tx
      .select({ id: calls.id })
      .from(calls)
      .where(and(eq(calls.id, callId), eq(calls.org_id, orgId)))
      .limit(1),
  );
  if (!call) return { ok: false, message: 'call_not_found' };

  const supportAddress = env.SUPPORT_EMAIL_ADDRESS;
  if (!supportAddress) {
    // Support address not configured — record the report in audit_log so
    // the team can still find it, then surface a friendly error.
    await withOrgContext(orgId, async (tx) => {
      await recordAudit(tx, {
        orgId,
        actorUserId: userId,
        actorType: 'user',
        action: 'call.issue_reported',
        subjectType: 'call',
        subjectId: callId,
        metadata: { message, deliveredEmail: false },
      });
    });
    return { ok: false, message: 'support_email_not_configured' };
  }

  const subject = `[VoiceFlow] Problema chiamata ${callId}`;
  const html = `
    <p>Una segnalazione di problema è stata aperta su una chiamata.</p>
    <ul>
      <li><strong>Org:</strong> ${orgId}</li>
      <li><strong>Utente:</strong> ${userId}</li>
      <li><strong>Call ID:</strong> ${callId}</li>
    </ul>
    <p><strong>Messaggio:</strong></p>
    <pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(message)}</pre>
  `.trim();

  await sendEmail({
    to: supportAddress,
    subject,
    html,
    text: `Org: ${orgId}\nUtente: ${userId}\nCall ID: ${callId}\n\n${message}`,
  });

  await withOrgContext(orgId, async (tx) => {
    await recordAudit(tx, {
      orgId,
      actorUserId: userId,
      actorType: 'user',
      action: 'call.issue_reported',
      subjectType: 'call',
      subjectId: callId,
      metadata: { message, deliveredEmail: true },
    });
  });

  return { ok: true };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
