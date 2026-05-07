import { redirect } from 'next/navigation';

import { listGdprHistory } from '@/actions/compliance';
import { getAuthContext, hasCapability } from '@/lib/auth/context';

import { ComplianceSettingsClient } from './_components/compliance-settings-client';

export default async function ComplianceSettingsPage() {
  const { role } = await getAuthContext();

  // Read access is gated on `compliance.export` (which all roles except
  // `operator` hold). The page is opened from the settings nav, so users
  // without the capability are bounced to the dashboard rather than shown an
  // empty page.
  if (!hasCapability(role, 'compliance.export')) {
    redirect('/dashboard');
  }

  const canErase = hasCapability(role, 'compliance.erase');

  const historyResult = await listGdprHistory({ limit: 50 });
  const history = historyResult.ok && historyResult.data ? historyResult.data.entries : [];

  return <ComplianceSettingsClient canErase={canErase} initialHistory={history} />;
}
