'use client';

import { useEffect } from 'react';

import { setSentryUser } from '@/lib/observability';

export function SentryUserSync({ userId, orgId }: { userId: string; orgId: string }) {
  useEffect(() => {
    setSentryUser(userId, orgId);
  }, [userId, orgId]);

  return null;
}
