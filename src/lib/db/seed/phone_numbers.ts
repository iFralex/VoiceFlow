import type { NewPhoneNumber } from '../schema/phone_numbers';

/**
 * Shared CLI pool seed.
 *
 * The platform places outbound calls with Italian caller IDs ("CLIs") that
 * Italian recipients recognise — local landlines for the major metros and
 * Italian mobile numbers (+393…). The picker (`src/lib/voice/cli/picker.ts`,
 * plan 10 task 4) selects from these rows; the dispatcher hands the chosen
 * number's `provider_external_id` to Vapi as the `fromNumber`.
 *
 * Composition (15 DIDs, per plan 10 task 1):
 *   - 10 from the primary Italian SBC (Voiped Telecom):
 *       3 mobile (+393…) and 7 geographic landlines spread across
 *       Milano (02), Roma (06), Torino (011), Napoli (081), Bologna (051).
 *   - 5 Twilio Italian numbers as failover (engaged when the SBC trunk
 *     degrades — see plan 10 task 13).
 *
 * The e164 values below are PLACEHOLDERS. Procurement (plan 10 task 1) is a
 * manual founder action; once the real DIDs are issued, replace these
 * placeholders and the matching `provider_external_id` values (the Vapi
 * `phoneNumberId` captured during BYO-trunk import — plan 10 task 2) and
 * re-run `pnpm db:seed`.
 */

export const phoneNumberSeedData: NewPhoneNumber[] = [
  // ---- Voiped: 3 mobile DIDs ----
  {
    e164: '+393900000001',
    org_id: null,
    provider: 'voiped',
    provider_external_id: null,
    status: 'active',
    region: null,
    capabilities: ['mobile'],
    daily_call_count: 0,
    spam_score: '0',
  },
  {
    e164: '+393900000002',
    org_id: null,
    provider: 'voiped',
    provider_external_id: null,
    status: 'active',
    region: null,
    capabilities: ['mobile'],
    daily_call_count: 0,
    spam_score: '0',
  },
  {
    e164: '+393900000003',
    org_id: null,
    provider: 'voiped',
    provider_external_id: null,
    status: 'active',
    region: null,
    capabilities: ['mobile'],
    daily_call_count: 0,
    spam_score: '0',
  },
  // ---- Voiped: 7 geographic landlines ----
  {
    e164: '+390200000001',
    org_id: null,
    provider: 'voiped',
    provider_external_id: null,
    status: 'active',
    region: 'milano',
    capabilities: ['landline'],
    daily_call_count: 0,
    spam_score: '0',
  },
  {
    e164: '+390200000002',
    org_id: null,
    provider: 'voiped',
    provider_external_id: null,
    status: 'active',
    region: 'milano',
    capabilities: ['landline'],
    daily_call_count: 0,
    spam_score: '0',
  },
  {
    e164: '+390600000001',
    org_id: null,
    provider: 'voiped',
    provider_external_id: null,
    status: 'active',
    region: 'roma',
    capabilities: ['landline'],
    daily_call_count: 0,
    spam_score: '0',
  },
  {
    e164: '+390600000002',
    org_id: null,
    provider: 'voiped',
    provider_external_id: null,
    status: 'active',
    region: 'roma',
    capabilities: ['landline'],
    daily_call_count: 0,
    spam_score: '0',
  },
  {
    e164: '+39011000001',
    org_id: null,
    provider: 'voiped',
    provider_external_id: null,
    status: 'active',
    region: 'torino',
    capabilities: ['landline'],
    daily_call_count: 0,
    spam_score: '0',
  },
  {
    e164: '+39081000001',
    org_id: null,
    provider: 'voiped',
    provider_external_id: null,
    status: 'active',
    region: 'napoli',
    capabilities: ['landline'],
    daily_call_count: 0,
    spam_score: '0',
  },
  {
    e164: '+39051000001',
    org_id: null,
    provider: 'voiped',
    provider_external_id: null,
    status: 'active',
    region: 'bologna',
    capabilities: ['landline'],
    daily_call_count: 0,
    spam_score: '0',
  },
  // ---- Twilio failover: 5 DIDs ----
  {
    e164: '+393900000101',
    org_id: null,
    provider: 'twilio',
    provider_external_id: null,
    status: 'active',
    region: null,
    capabilities: ['mobile'],
    daily_call_count: 0,
    spam_score: '0',
  },
  {
    e164: '+390200000101',
    org_id: null,
    provider: 'twilio',
    provider_external_id: null,
    status: 'active',
    region: 'milano',
    capabilities: ['landline'],
    daily_call_count: 0,
    spam_score: '0',
  },
  {
    e164: '+390600000101',
    org_id: null,
    provider: 'twilio',
    provider_external_id: null,
    status: 'active',
    region: 'roma',
    capabilities: ['landline'],
    daily_call_count: 0,
    spam_score: '0',
  },
  {
    e164: '+39011000101',
    org_id: null,
    provider: 'twilio',
    provider_external_id: null,
    status: 'active',
    region: 'torino',
    capabilities: ['landline'],
    daily_call_count: 0,
    spam_score: '0',
  },
  {
    e164: '+39081000101',
    org_id: null,
    provider: 'twilio',
    provider_external_id: null,
    status: 'active',
    region: 'napoli',
    capabilities: ['landline'],
    daily_call_count: 0,
    spam_score: '0',
  },
];
