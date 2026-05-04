import { env } from '@/lib/env';

export interface InngestEventPayload {
  name: string;
  data: Record<string, unknown>;
  id?: string;
}

/**
 * Sends one event to Inngest via the HTTP Events API.
 *
 * The base URL defaults to https://inn.gs (Inngest cloud) but can be overridden
 * via INNGEST_BASE_URL for local dev (e.g. http://localhost:8288 when the
 * Inngest Dev Server is running).
 *
 * When the Inngest SDK is installed in a later plan, callers can be migrated
 * to `inngest.send()` — the signature is identical.
 */
export async function sendInngestEvent(event: InngestEventPayload): Promise<void> {
  const eventKey = env.INNGEST_EVENT_KEY;
  const baseUrl = process.env['INNGEST_BASE_URL'] ?? 'https://inn.gs';

  const response = await fetch(`${baseUrl}/e/${eventKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ name: event.name, data: event.data, ...(event.id ? { id: event.id } : {}) }]),
  });

  if (!response.ok) {
    throw new Error(`Inngest event send failed: ${response.status} ${response.statusText}`);
  }
}
