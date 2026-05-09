import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { getAuthContext, hasCapability } from '@/lib/auth/context';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import { auditLog, campaigns, contacts, scripts } from '@/lib/db/schema';
import { fetchCallTimeline } from '@/lib/services/calls';
import { getCallMediaDownloadUrl } from '@/lib/storage/signed';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { CALL_MEDIA_BUCKET } from '@/lib/voice/persistence';
import type { TranscriptSegment } from '@/lib/voice/types';

import type { SerializedCallDetail } from './_components/call-detail-client';
import { CallDetailClient } from './_components/call-detail-client';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CallDetailPage({ params }: Props) {
  const { id } = await params;
  const { orgId, role } = await getAuthContext();

  const timeline = await fetchCallTimeline(orgId, id);
  if (!timeline) notFound();
  const { call, events } = timeline;

  // Resolve contact, campaign, script names in parallel.
  const [contactRow, campaignRow, scriptRow] = await Promise.all([
    call.contact_id
      ? withOrgContext(orgId, (tx) =>
          tx
            .select({
              first_name: contacts.first_name,
              last_name: contacts.last_name,
              phone_e164: contacts.phone_e164,
            })
            .from(contacts)
            .where(and(eq(contacts.id, call.contact_id!), eq(contacts.org_id, orgId)))
            .limit(1),
        ).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    call.campaign_id
      ? withOrgContext(orgId, (tx) =>
          tx
            .select({ id: campaigns.id, name: campaigns.name, script_id: campaigns.script_id })
            .from(campaigns)
            .where(and(eq(campaigns.id, call.campaign_id!), eq(campaigns.org_id, orgId)))
            .limit(1),
        ).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    Promise.resolve(null) as Promise<{ id: string; name: string } | null>,
  ]);

  const resolvedScript = campaignRow
    ? await withOrgContext(orgId, (tx) =>
        tx
          .select({ id: scripts.id, name: scripts.name })
          .from(scripts)
          .where(and(eq(scripts.id, campaignRow.script_id), eq(scripts.org_id, orgId)))
          .limit(1),
      ).then((r) => r[0] ?? null)
    : scriptRow;

  // Issue-report audit entries are written as subject_type='call' but they live
  // in audit_log only — fetchCallTimeline already returns them. Filter the
  // events into a structured timeline for the milestone display vs. the audit
  // tab.
  const auditEntries = events.map((e) => ({
    type: e.type,
    timestamp: e.timestamp.toISOString(),
    data: e.data,
  }));

  // Signed URL for the recording (60s TTL). If no recording yet, leave null
  // and the client will render an "in elaborazione" placeholder.
  let recordingUrl: string | null = null;
  if (call.recording_path) {
    try {
      recordingUrl = await getCallMediaDownloadUrl(call.recording_path, 60);
    } catch {
      recordingUrl = null;
    }
  }

  // Transcript JSON, downloaded server-side and shipped as a prop.
  let transcript: TranscriptSegment[] = [];
  if (call.transcript_path) {
    try {
      const { data } = await supabaseAdmin.storage
        .from(CALL_MEDIA_BUCKET)
        .download(call.transcript_path);
      if (data) {
        const text = await data.text();
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) transcript = parsed as TranscriptSegment[];
      }
    } catch {
      transcript = [];
    }
  }

  // Pull a fresh, narrowly-scoped audit slice (capability-gated) for the audit
  // tab. fetchCallTimeline already returned this set, but we keep the shape
  // explicit in case future iterations split timeline events from audit
  // entries.
  const canViewAudit = hasCapability(role, 'audit.view');
  const auditTabEntries = canViewAudit
    ? await withSystemContext((tx) =>
        tx
          .select({
            id: auditLog.id,
            actor_user_id: auditLog.actor_user_id,
            actor_type: auditLog.actor_type,
            action: auditLog.action,
            metadata: auditLog.metadata,
            created_at: auditLog.created_at,
          })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.org_id, orgId),
              eq(auditLog.subject_type, 'call'),
              eq(auditLog.subject_id, id),
            ),
          )
          .orderBy(auditLog.created_at),
      ).then((rows) =>
        rows.map((r) => ({
          id: String(r.id),
          actorUserId: r.actor_user_id,
          actorType: r.actor_type,
          action: r.action,
          metadata: (r.metadata as Record<string, unknown>) ?? {},
          createdAt: r.created_at.toISOString(),
        })),
      )
    : null;

  const contactName =
    contactRow !== null
      ? [contactRow.first_name, contactRow.last_name].filter(Boolean).join(' ').trim() ||
        contactRow.phone_e164
      : null;

  const serialized: SerializedCallDetail = {
    id: call.id,
    status: call.status,
    outcome: call.outcome,
    direction: call.direction,
    contactName,
    contactPhone: contactRow?.phone_e164 ?? null,
    campaignId: campaignRow?.id ?? null,
    campaignName: campaignRow?.name ?? null,
    scriptName: resolvedScript?.name ?? null,
    startedAt: call.started_at?.toISOString() ?? null,
    endedAt: call.ended_at?.toISOString() ?? null,
    createdAt: call.created_at.toISOString(),
    billableSeconds: call.billable_seconds ?? null,
    costCents: call.cost_cents ?? null,
    metadata: (call.metadata as Record<string, unknown> | null) ?? {},
    recordingUrl,
    recordingAvailable: call.recording_path !== null,
    transcript,
    transcriptAvailable: call.transcript_path !== null,
    timelineEvents: auditEntries,
    auditEntries: auditTabEntries,
    canRefund: hasCapability(role, 'billing.topup'),
    canReport: hasCapability(role, 'campaigns.view'),
  };

  return <CallDetailClient call={serialized} />;
}
