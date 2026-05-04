/**
 * Inbucket helpers for E2E tests.
 *
 * Supabase local development runs Inbucket on port 54324 to catch all outgoing
 * emails without a real SMTP server. These helpers poll the Inbucket REST API
 * to retrieve magic-link emails sent during auth flows.
 *
 * Inbucket API reference:
 *   GET /api/v1/mailbox/{address}         — list messages
 *   GET /api/v1/mailbox/{address}/{id}    — get message body (HTML + text)
 *   DELETE /api/v1/mailbox/{address}/{id} — delete message
 */

const INBUCKET_URL = process.env['INBUCKET_URL'] ?? 'http://localhost:54324';
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 15_000;

interface InbucketMessage {
  id: string;
  from: string;
  subject: string;
  date: string;
  size: number;
  seen: boolean;
}

interface InbucketMessageBody {
  id: string;
  subject: string;
  body: {
    text: string;
    html: string;
  };
}

/**
 * Normalises an email address to the local-part only, which is how Inbucket
 * indexes its mailboxes (e.g. "test+1234@example.com" → "test+1234").
 *
 * Inbucket uses the full address as a key for its REST API, but strips the
 * domain for its internal mailbox identifier. We keep the full address in API
 * calls so the URL is correct regardless of Inbucket version.
 */
function mailboxPath(email: string): string {
  return encodeURIComponent(email.toLowerCase());
}

/**
 * Lists all messages in an Inbucket mailbox for the given email address.
 * Returns an empty array when no messages exist (instead of throwing).
 */
async function listMessages(email: string): Promise<InbucketMessage[]> {
  const res = await fetch(`${INBUCKET_URL}/api/v1/mailbox/${mailboxPath(email)}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Inbucket list failed: ${res.status}`);
  const data = (await res.json()) as InbucketMessage[] | null;
  return data ?? [];
}

/**
 * Fetches the full body of a specific message.
 */
async function getMessage(email: string, id: string): Promise<InbucketMessageBody> {
  const res = await fetch(`${INBUCKET_URL}/api/v1/mailbox/${mailboxPath(email)}/${id}`);
  if (!res.ok) throw new Error(`Inbucket get failed: ${res.status}`);
  return res.json() as Promise<InbucketMessageBody>;
}

/**
 * Deletes a message so subsequent polls don't pick up stale messages.
 */
async function deleteMessage(email: string, id: string): Promise<void> {
  await fetch(`${INBUCKET_URL}/api/v1/mailbox/${mailboxPath(email)}/${id}`, {
    method: 'DELETE',
  });
}

/**
 * Extracts the first HTTP(S) URL from the plain-text or HTML body of a message.
 * Supabase magic-link emails include the link as an anchor in the HTML body
 * and as a raw URL in the text body.
 *
 * Prefers the text body URL when available (simpler extraction); falls back to
 * parsing the first `href` in the HTML body.
 */
export function extractLinkFromBody(body: InbucketMessageBody['body']): string | null {
  // Try text body first — most reliable
  const textMatch = body.text.match(/https?:\/\/[^\s"'<>]+/);
  if (textMatch) return textMatch[0].trim();

  // Fallback: extract href from HTML anchor
  const htmlMatch = body.html.match(/href="(https?:\/\/[^"]+)"/);
  if (htmlMatch) return htmlMatch[1] ?? null;

  return null;
}

/**
 * Polls Inbucket for a new message sent to `email`, then returns the magic
 * link URL contained in that message.
 *
 * Waits up to POLL_TIMEOUT_MS for a message to appear. If `afterDate` is
 * supplied, only messages received after that timestamp are considered (useful
 * to ignore leftover messages from previous test runs).
 *
 * @throws If no message arrives within the timeout window.
 */
export async function waitForMagicLink(
  email: string,
  { afterDate = new Date(0) }: { afterDate?: Date } = {},
): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const messages = await listMessages(email);
    const newMsg = messages.find((m) => new Date(m.date) > afterDate);

    if (newMsg) {
      const body = await getMessage(email, newMsg.id);
      const link = extractLinkFromBody(body.body);
      // Clean up so future polls in the same test run don't re-use this message
      await deleteMessage(email, newMsg.id);
      if (link) return link;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Timed out waiting for magic-link email for ${email} after ${POLL_TIMEOUT_MS}ms`,
  );
}

/**
 * Purges all messages in the Inbucket mailbox for the given email address.
 * Call this in test teardown to prevent cross-test pollution.
 */
export async function clearMailbox(email: string): Promise<void> {
  const messages = await listMessages(email);
  await Promise.all(messages.map((m) => deleteMessage(email, m.id)));
}
