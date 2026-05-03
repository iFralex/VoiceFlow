import { and, eq, isNotNull, isNull } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import { memberships, organizations } from '@/lib/db/schema';
import type { Organization } from '@/lib/db/schema';

/**
 * Validates an Italian P.IVA (Partita IVA) using the official checksum algorithm.
 * Returns true if the format and checksum are correct.
 */
export function validateItalianVat(vat: string): boolean {
  const digits = vat.trim().replace(/\s/g, '');
  if (!/^\d{11}$/.test(digits)) return false;

  let s = 0;
  // Odd positions (1-indexed: 1,3,5,7,9 → 0-indexed: 0,2,4,6,8): sum directly
  for (const i of [0, 2, 4, 6, 8]) {
    s += Number(digits[i]);
  }
  // Even positions (1-indexed: 2,4,6,8,10 → 0-indexed: 1,3,5,7,9): double; if ≥10 subtract 9
  for (const i of [1, 3, 5, 7, 9]) {
    const d = Number(digits[i]) * 2;
    s += d >= 10 ? d - 9 : d;
  }

  const check = (10 - (s % 10)) % 10;
  return check === Number(digits[10]);
}

export async function createOrganization(input: {
  ownerId: string;
  name: string;
  legalName?: string;
  vatNumber?: string;
}): Promise<Organization> {
  if (input.vatNumber !== undefined && !validateItalianVat(input.vatNumber)) {
    throw new Error('invalid_vat_number');
  }

  return withSystemContext(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({
        name: input.name,
        legal_name: input.legalName ?? null,
        vat_number: input.vatNumber ?? null,
      })
      .returning();

    await tx.insert(memberships).values({
      org_id: org!.id,
      user_id: input.ownerId,
      role: 'owner',
      accepted_at: new Date(),
    });

    await recordAudit(tx, {
      orgId: org!.id,
      actorUserId: input.ownerId,
      actorType: 'user',
      action: 'org.created',
      subjectType: 'organization',
      subjectId: org!.id,
      metadata: { name: input.name },
    });

    return org!;
  });
}

export async function getOrganization(orgId: string): Promise<Organization | null> {
  return withOrgContext(orgId, async (tx) => {
    const [org] = await tx
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, orgId), isNull(organizations.deleted_at)));
    return org ?? null;
  });
}

export async function listOrganizationsForUser(userId: string): Promise<Organization[]> {
  return withSystemContext(async (tx) => {
    const rows = await tx
      .select({ org: organizations })
      .from(organizations)
      .innerJoin(memberships, eq(memberships.org_id, organizations.id))
      .where(
        and(
          eq(memberships.user_id, userId),
          isNotNull(memberships.accepted_at),
          isNull(organizations.deleted_at),
        ),
      );
    return rows.map((r) => r.org);
  });
}

export async function updateOrganization(
  orgId: string,
  patch: Partial<Pick<Organization, 'name' | 'legal_name' | 'vat_number' | 'timezone'>>,
): Promise<Organization> {
  if (patch.vat_number !== undefined && patch.vat_number !== null) {
    if (!validateItalianVat(patch.vat_number)) {
      throw new Error('invalid_vat_number');
    }
  }

  return withOrgContext(orgId, async (tx) => {
    const [updated] = await tx
      .update(organizations)
      .set(patch)
      .where(and(eq(organizations.id, orgId), isNull(organizations.deleted_at)))
      .returning();

    if (!updated) {
      throw new Error('organization_not_found');
    }

    return updated;
  });
}

export async function softDeleteOrganization(orgId: string, byUserId: string): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    const [deleted] = await tx
      .update(organizations)
      .set({ deleted_at: new Date() })
      .where(and(eq(organizations.id, orgId), isNull(organizations.deleted_at)))
      .returning({ id: organizations.id });

    if (!deleted) {
      throw new Error('organization_not_found');
    }

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'org.deleted',
      subjectType: 'organization',
      subjectId: orgId,
    });
  });
}
