import { getAuthContext } from '@/lib/auth/context';
import { computePerMinuteCents } from '@/lib/services/billing-rules';
import { listContactLists } from '@/lib/services/contact_lists';
import { getBalance } from '@/lib/services/credit';
import { listScriptsWithTemplates } from '@/lib/services/scripts';

import type { ContactListOption, ScriptOption } from './_components/new-campaign-wizard';
import { NewCampaignWizard } from './_components/new-campaign-wizard';

type SearchParams = Promise<{ script?: string }>;

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getAuthContext();
  const { script: initialScriptId } = await searchParams;

  const [scriptRows, contactListRows, balance, perMinuteCents] = await Promise.all([
    listScriptsWithTemplates(orgId),
    listContactLists(orgId),
    getBalance(orgId),
    computePerMinuteCents(orgId),
  ]);

  const scripts: ScriptOption[] = scriptRows.map((s) => ({
    id: s.id,
    name: s.name,
    template_name: s.template_name,
  }));

  // Only expose completed lists (valid contacts are only in completed imports)
  const contactLists: ContactListOption[] = contactListRows
    .filter((l) => l.import_status === 'completed')
    .map((l) => ({
      id: l.id,
      name: l.name,
      valid_count: l.valid_count,
    }));

  return (
    <div className="container max-w-5xl py-8">
      <NewCampaignWizard
        scripts={scripts}
        contactLists={contactLists}
        balanceCents={balance.balanceCents}
        remainingMinutes={balance.remainingMinutes}
        perMinuteCents={perMinuteCents}
        {...(initialScriptId ? { initialScriptId } : {})}
      />
    </div>
  );
}
