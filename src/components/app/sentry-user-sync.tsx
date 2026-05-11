'use client';

import { useEffect } from 'react';

import { clearSentryUser, setSentryUser } from '@/lib/observability';

export function SentryUserSync({ userId, orgId }: { userId: string; orgId: string }) {
  useEffect(() => {
    setSentryUser(userId, orgId);
    return () => {
      clearSentryUser();
    };
  }, [userId, orgId]);

  return null;
}
