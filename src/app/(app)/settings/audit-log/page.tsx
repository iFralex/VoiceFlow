import { redirect } from 'next/navigation';

import { getAuthContext, hasCapability } from '@/lib/auth/context';
import { listAuditLog } from '@/lib/services/audit_log';

import { AuditLogPageClient } from './_components/audit-log-page-client';

const INITIAL_PAGE_SIZE = 50;

export default async function AuditLogPage() {
  const { orgId, role } = await getAuthContext();

  if (!hasCapability(role, 'audit.view')) {
    redirect('/dashboard');
  }

  const initial = await listAuditLog({ orgId, limit: INITIAL_PAGE_SIZE });

  const initialEntries = initial.entries.map((entry) => ({
    id: entry.id,
    createdAt: entry.createdAt.toISOString(),
    actorType: entry.actorType,
    actorUserId: entry.actorUserId,
    actorEmail: entry.actorEmail,
    action: entry.action,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
    metadata: entry.metadata,
  }));

  return (
    <AuditLogPageClient
      initialEntries={initialEntries}
      initialCursor={initial.nextCursor}
      pageSize={INITIAL_PAGE_SIZE}
    />
  );
}
