/**
 * scripts/add-cli.ts — admin tool for plan 10 task 8.
 *
 * Inserts one row into `phone_numbers` for a freshly procured DID. The founder
 * runbook (`docs/runbooks/cli-pool-management.md`) drives this tool; the input
 * contract and validation live in `src/lib/voice/cli/add-cli.ts` so they can
 * be unit-tested without spinning up a database.
 *
 * Usage:
 *   pnpm exec tsx scripts/add-cli.ts \
 *     --e164 +390212345678 \
 *     --provider voiped \
 *     --vapi-id pn_abc123 \
 *     --region milano \
 *     --capabilities landline \
 *     [--org-id <uuid>]
 */

import { AddCliArgsError, addCli, parseAddCliArgs } from '@/lib/voice/cli/add-cli';

const USAGE = `\
Usage: pnpm exec tsx scripts/add-cli.ts \\
  --e164 <E.164> \\
  --provider <voiped|twilio|telnyx> \\
  --vapi-id <vapi-phone-number-id> \\
  [--region <slug>] \\
  [--capabilities <csv>] \\
  [--org-id <uuid>]

Examples:
  # shared-pool DID
  pnpm exec tsx scripts/add-cli.ts \\
    --e164 +390212345678 --provider voiped --vapi-id pn_abc \\
    --region milano --capabilities landline

  # org-dedicated DID (plan 10 task 12)
  pnpm exec tsx scripts/add-cli.ts \\
    --e164 +393401234567 --provider voiped --vapi-id pn_xyz \\
    --capabilities mobile --org-id 11111111-2222-3333-4444-555555555555
`;

async function main(): Promise<void> {
  let input;
  try {
    input = parseAddCliArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof AddCliArgsError) {
      console.error(`Error: ${err.message}\n\n${USAGE}`);
      process.exit(1);
    }
    throw err;
  }

  const inserted = await addCli(input);
  console.warn(
    `Inserted phone_numbers row id=${inserted.id} e164=${inserted.e164}` +
      ` provider=${inserted.provider} region=${inserted.region ?? '(null)'}` +
      ` org=${inserted.org_id ?? 'shared'}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('add-cli failed:', err);
    process.exit(1);
  });
