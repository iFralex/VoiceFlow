/**
 * Client for the Italian Registro Pubblico delle Opposizioni (RPO).
 *
 * RPO is the national do-not-call registry. Calling B2C numbers without
 * checking the registry is a regulatory violation (spec §12.2). Direct
 * RPO access requires significant onboarding, so we integrate via a
 * third-party intermediary (e.g. Datatec, Compliance Solutions).
 *
 * Two operations are supported:
 *  - `bulkCheck`  — used by the daily snapshot cron (Task 2) and the
 *    contact-import pipeline (Task 3).
 *  - `singleCheck` — used at dispatch time (Task 4) as a per-call safety net.
 */

import { env } from '@/lib/env';

export interface RpoClient {
  /**
   * Check a batch of E.164 phone numbers. Returns a map keyed by E.164
   * with `true` when the number appears on the RPO registry.
   */
  bulkCheck(phoneNumbers: string[]): Promise<Map<string, boolean>>;

  /**
   * Check a single E.164 phone number live at the moment of dispatch.
   * Throws on transport / API errors so callers can fall back to stale
   * snapshot data.
   */
  singleCheck(phoneE164: string): Promise<{ isBlocked: boolean; checkedAt: Date }>;
}

interface BulkResponseEntry {
  phone: string;
  blocked: boolean;
}

interface BulkResponse {
  results: BulkResponseEntry[];
}

interface SingleResponse {
  blocked: boolean;
  checked_at?: string;
}

/**
 * Maximum number of phone numbers per outgoing bulkCheck request. The
 * intermediary's documented ceiling is 1 000 entries; we stay one chunk
 * below to leave room for retries.
 */
const BULK_REQUEST_CHUNK_SIZE = 500;

/**
 * Normalises a phone number to its E.164 form (`+` prefix, digits only).
 * Throws on values that do not match the expected shape so we never send
 * malformed data to the intermediary.
 */
function assertE164(phone: string): string {
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
    throw new Error(`Invalid E.164 phone number: ${phone}`);
  }
  return phone;
}

export class RpoIntermediaryClient implements RpoClient {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
  ) {}

  async bulkCheck(numbers: string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    if (numbers.length === 0) return result;

    const validated = numbers.map(assertE164);
    for (let offset = 0; offset < validated.length; offset += BULK_REQUEST_CHUNK_SIZE) {
      const chunk = validated.slice(offset, offset + BULK_REQUEST_CHUNK_SIZE);
      const response = await fetch(`${this.endpoint}/bulk-check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ phones: chunk }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`RPO bulk-check failed: ${response.status} ${body}`);
      }

      const payload = (await response.json()) as BulkResponse;
      for (const entry of payload.results ?? []) {
        result.set(entry.phone, Boolean(entry.blocked));
      }
    }

    return result;
  }

  async singleCheck(phoneE164: string): Promise<{ isBlocked: boolean; checkedAt: Date }> {
    const phone = assertE164(phoneE164);
    const url = `${this.endpoint}/check?phone=${encodeURIComponent(phone)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`RPO single-check failed: ${response.status} ${body}`);
    }

    const payload = (await response.json()) as SingleResponse;
    const checkedAt = payload.checked_at ? new Date(payload.checked_at) : new Date();
    return { isBlocked: Boolean(payload.blocked), checkedAt };
  }
}

/**
 * Deterministic mock for development and tests. Returns ~5% block rate
 * derived from a hash of the phone number so the same number always
 * resolves the same way within a process.
 */
export class RpoMockClient implements RpoClient {
  // ~5% block rate
  private static readonly BLOCK_THRESHOLD = 13;

  private hash(phone: string): number {
    let h = 0;
    for (let i = 0; i < phone.length; i += 1) {
      h = ((h << 5) - h + phone.charCodeAt(i)) | 0;
    }
    return Math.abs(h) % 256;
  }

  async bulkCheck(numbers: string[]): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>();
    for (const phone of numbers) {
      const e164 = assertE164(phone);
      out.set(e164, this.hash(e164) < RpoMockClient.BLOCK_THRESHOLD);
    }
    return out;
  }

  async singleCheck(phoneE164: string): Promise<{ isBlocked: boolean; checkedAt: Date }> {
    const phone = assertE164(phoneE164);
    return {
      isBlocked: this.hash(phone) < RpoMockClient.BLOCK_THRESHOLD,
      checkedAt: new Date(),
    };
  }
}

/**
 * Returns the RPO client appropriate for the current environment.
 *
 * - In production, always uses the live intermediary; throws if credentials
 *   are missing so misconfiguration fails loudly.
 * - In development and test, uses the live client when both credentials
 *   are present (e.g. against a sandbox endpoint), otherwise falls back
 *   to {@link RpoMockClient}.
 */
export function getRpoClient(): RpoClient {
  const endpoint = env.RPO_PROVIDER_ENDPOINT;
  const apiKey = env.RPO_PROVIDER_API_KEY;

  if (env.NODE_ENV === 'production') {
    if (!endpoint || !apiKey) {
      throw new Error(
        'RPO_PROVIDER_ENDPOINT and RPO_PROVIDER_API_KEY must be configured in production',
      );
    }
    return new RpoIntermediaryClient(endpoint, apiKey);
  }

  if (endpoint && apiKey) {
    return new RpoIntermediaryClient(endpoint, apiKey);
  }
  return new RpoMockClient();
}
