import crypto from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import { personalAccessTokens } from '@/lib/db/schema';
import type { PersonalAccessToken } from '@/lib/db/schema';

// ── Token generation ──────────────────────────────────────────────────────────

/**
 * Generates a cryptographically random bearer token with a human-readable prefix.
 * Format: `vx_<random-hex-48-chars>` (total 51 chars)
 */
function generateRawToken(): string {
  return `vx_${crypto.randomBytes(24).toString('hex')}`;
}

/** SHA-256 hex digest of a raw token */
function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// ── Service functions ─────────────────────────────────────────────────────────

export interface CreatePatInput {
  userId: string;
  orgId: string;
  name: string;
  scopes: string[];
  /** ISO date string or Date; undefined = no expiry */
  expiresAt?: Date | string;
}

export interface CreatePatResult {
  pat: PersonalAccessToken;
  /** The raw token — shown once, never stored */
  rawToken: string;
}

/**
 * Creates a new Personal Access Token.
 * Returns the saved PAT record and the raw token (shown to the user once).
 */
export async function createPat(input: CreatePatInput): Promise<CreatePatResult> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const prefix = rawToken.slice(0, 8);

  const expiresAt =
    input.expiresAt instanceof Date
      ? input.expiresAt
      : input.expiresAt
        ? new Date(input.expiresAt)
        : null;

  const pat = await withOrgContext(input.orgId, async (tx) => {
    const [created] = await tx
      .insert(personalAccessTokens)
      .values({
        user_id: input.userId,
        org_id: input.orgId,
        name: input.name,
        token_hash: tokenHash,
        prefix,
        scopes: input.scopes,
        ...(expiresAt ? { expires_at: expiresAt } : {}),
      })
      .returning();

    await recordAudit(tx, {
      orgId: input.orgId,
      actorUserId: input.userId,
      actorType: 'user',
      action: 'pat.created',
      subjectType: 'personal_access_token',
      subjectId: created!.id,
      metadata: { name: input.name, scopes: input.scopes },
    });

    return created!;
  });

  return { pat, rawToken };
}

/**
 * Revokes a PAT by setting revoked_at.
 * Only the owning user can revoke their token.
 */
export async function revokePat(patId: string, byUserId: string, orgId: string): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    const [revoked] = await tx
      .update(personalAccessTokens)
      .set({ revoked_at: new Date() })
      .where(
        and(
          eq(personalAccessTokens.id, patId),
          eq(personalAccessTokens.user_id, byUserId),
          eq(personalAccessTokens.org_id, orgId),
          isNull(personalAccessTokens.revoked_at),
        ),
      )
      .returning({ id: personalAccessTokens.id });

    if (!revoked) {
      throw new Error('pat_not_found');
    }

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'pat.revoked',
      subjectType: 'personal_access_token',
      subjectId: patId,
    });
  });
}

/**
 * Lists active (non-revoked, non-expired) PATs for a user within an org.
 */
export async function listPats(
  userId: string,
  orgId: string,
): Promise<PersonalAccessToken[]> {
  return withOrgContext(orgId, async (tx) => {
    return tx
      .select()
      .from(personalAccessTokens)
      .where(
        and(
          eq(personalAccessTokens.user_id, userId),
          eq(personalAccessTokens.org_id, orgId),
          isNull(personalAccessTokens.revoked_at),
        ),
      );
  });
}

export interface VerifiedPat {
  userId: string;
  orgId: string;
  scopes: string[];
  patId: string;
}

/**
 * Verifies a raw bearer token.
 * - Hashes the raw token and looks it up in the DB.
 * - Returns null if not found, revoked, or expired.
 * - Updates last_used_at on success (fire-and-forget, no throw on failure).
 */
export async function verifyPat(rawToken: string): Promise<VerifiedPat | null> {
  const tokenHash = hashToken(rawToken);

  return withSystemContext(async (tx) => {
    const [row] = await tx
      .select()
      .from(personalAccessTokens)
      .where(eq(personalAccessTokens.token_hash, tokenHash));

    if (!row) return null;
    if (row.revoked_at) return null;
    if (row.expires_at && row.expires_at < new Date()) return null;

    // Update last_used_at without throwing on race conditions
    try {
      await tx
        .update(personalAccessTokens)
        .set({ last_used_at: new Date() })
        .where(eq(personalAccessTokens.id, row.id));
    } catch {
      // Non-fatal: last_used_at is informational only
    }

    return {
      userId: row.user_id,
      orgId: row.org_id,
      scopes: row.scopes,
      patId: row.id,
    };
  });
}
