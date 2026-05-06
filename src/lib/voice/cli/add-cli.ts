/**
 * Logic backing the `scripts/add-cli.ts` admin tool (plan 10 task 8).
 *
 * Inserts one row into `phone_numbers` for a freshly procured DID. The
 * argument parsing and validation live here (instead of inline in the script)
 * so unit tests can exercise the input contract without spinning up a DB.
 *
 * Used by the founder runbook in `docs/runbooks/cli-pool-management.md`:
 *   - normal pool top-up (no `--org-id` → row joins the shared pool)
 *   - org-dedicated CLI assignment (Task 12 — `--org-id <uuid>` → row is
 *     excluded from the shared pool by the picker's ownership rank)
 */

import { type DbTx, withSystemContext } from '@/lib/db/context';
import { phoneNumbers, phoneProviderEnum } from '@/lib/db/schema';

const PROVIDERS = phoneProviderEnum.enumValues;
type PhoneProvider = (typeof PROVIDERS)[number];

const E164_REGEX = /^\+\d{8,15}$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AddCliInput {
  e164: string;
  provider: PhoneProvider;
  vapiId: string;
  region: string | null;
  capabilities: string[];
  orgId: string | null;
}

export interface InsertedCli {
  id: string;
  e164: string;
  provider: PhoneProvider;
  provider_external_id: string | null;
  region: string | null;
  capabilities: string[];
  org_id: string | null;
}

export class AddCliArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddCliArgsError';
  }
}

/**
 * Parses argv (the slice after node + script path, i.e. `process.argv.slice(2)`)
 * into a validated `AddCliInput`. Throws `AddCliArgsError` with a usage-style
 * message on any malformed or missing input — the script catches this and exits
 * non-zero.
 *
 * Recognised flags:
 *   --e164 <E.164>             required
 *   --provider <enum>          required (voiped | twilio | telnyx)
 *   --vapi-id <id>             required (Vapi phoneNumberId; written to
 *                              phone_numbers.provider_external_id)
 *   --region <slug>            optional (e.g. "milano"); empty/missing → null
 *   --capabilities <csv>       optional comma-separated list
 *                              (e.g. "landline" or "mobile,sms")
 *   --org-id <uuid>            optional (Task 12; org-dedicated CLI)
 */
export function parseAddCliArgs(argv: readonly string[]): AddCliInput {
  const flags = readFlags(argv);

  const e164 = required(flags, '--e164');
  if (!E164_REGEX.test(e164)) {
    throw new AddCliArgsError(
      `--e164 must be E.164 format (e.g. "+390212345678"); got "${e164}"`,
    );
  }

  const providerRaw = required(flags, '--provider');
  if (!isProvider(providerRaw)) {
    throw new AddCliArgsError(
      `--provider must be one of: ${PROVIDERS.join(', ')}; got "${providerRaw}"`,
    );
  }

  const vapiId = required(flags, '--vapi-id');

  const regionRaw = flags['--region'];
  const region = regionRaw && regionRaw.trim() !== '' ? regionRaw.trim() : null;

  const capabilitiesRaw = flags['--capabilities'];
  const capabilities = capabilitiesRaw
    ? capabilitiesRaw
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0)
    : [];

  const orgIdRaw = flags['--org-id'];
  let orgId: string | null = null;
  if (orgIdRaw && orgIdRaw.trim() !== '') {
    if (!UUID_REGEX.test(orgIdRaw.trim())) {
      throw new AddCliArgsError(
        `--org-id must be a UUID; got "${orgIdRaw}"`,
      );
    }
    orgId = orgIdRaw.trim().toLowerCase();
  }

  return { e164, provider: providerRaw, vapiId, region, capabilities, orgId };
}

/**
 * Inserts the row inside the caller-provided transaction, or opens a fresh
 * `withSystemContext` if none is provided. Returns the inserted row.
 *
 * Conflicts on the `phone_numbers_e164_unique` constraint: re-running with the
 * same E.164 fails. The runbook tells the founder to update by hand (or
 * migrate) instead — silently overwriting an existing CLI's metadata is risky
 * (it would also reset state the watchdog cares about).
 */
export async function addCli(
  input: AddCliInput,
  tx?: DbTx,
): Promise<InsertedCli> {
  const work = async (t: DbTx): Promise<InsertedCli> => {
    const [row] = await t
      .insert(phoneNumbers)
      .values({
        e164: input.e164,
        org_id: input.orgId,
        provider: input.provider,
        provider_external_id: input.vapiId,
        status: 'active',
        region: input.region,
        capabilities: input.capabilities,
        daily_call_count: 0,
        spam_score: '0',
      })
      .returning({
        id: phoneNumbers.id,
        e164: phoneNumbers.e164,
        provider: phoneNumbers.provider,
        provider_external_id: phoneNumbers.provider_external_id,
        region: phoneNumbers.region,
        capabilities: phoneNumbers.capabilities,
        org_id: phoneNumbers.org_id,
      });
    if (!row) {
      // Should be unreachable: insert with values is required to return one row
      // unless the DB is in an unusual state.
      throw new Error('phone_numbers insert returned no rows');
    }
    return row;
  };

  if (tx) return work(tx);
  return withSystemContext(work);
}

// ─── helpers ────────────────────────────────────────────────────────────────

function readFlags(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined || !token.startsWith('--')) {
      throw new AddCliArgsError(`Unexpected argument: "${token ?? ''}"`);
    }
    const eqIdx = token.indexOf('=');
    if (eqIdx !== -1) {
      // --flag=value form
      out[token.slice(0, eqIdx)] = token.slice(eqIdx + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new AddCliArgsError(`Missing value for ${token}`);
    }
    out[token] = next;
    i++;
  }
  return out;
}

function required(flags: Record<string, string>, key: string): string {
  const v = flags[key];
  if (v === undefined || v === '') {
    throw new AddCliArgsError(`Missing required flag ${key}`);
  }
  return v;
}

function isProvider(value: string): value is PhoneProvider {
  return (PROVIDERS as readonly string[]).includes(value);
}
