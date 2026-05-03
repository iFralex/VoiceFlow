'use client';

import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import type { MemberRole } from '@/types';

import { InviteMemberDialog } from './invite-member-dialog';
import { MemberActions } from './member-actions';

export type SerializedMember = {
  id: string;
  user_id: string;
  role: MemberRole;
  invited_at: string;
  accepted_at: string | null;
  user: {
    id: string;
    email: string;
    full_name: string | null;
  };
  lastSignInAt: string | null;
};

interface MembersPageClientProps {
  members: SerializedMember[];
  canInvite: boolean;
  canManage: boolean;
}

const ROLE_VARIANT: Record<MemberRole, 'default' | 'secondary' | 'outline'> = {
  owner: 'default',
  admin: 'secondary',
  operator: 'secondary',
  viewer: 'outline',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function MembersPageClient({ members, canInvite, canManage }: MembersPageClientProps) {
  const t = useTranslations('settings');

  const accepted = members.filter((m) => m.accepted_at !== null);
  const pending = members.filter((m) => m.accepted_at === null);

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('members_title')}</h1>
          <p className="text-sm text-muted-foreground">{t('members_description')}</p>
        </div>
        {canInvite && <InviteMemberDialog />}
      </div>

      {/* Active members */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t('accepted_members_title')}
        </h2>

        {accepted.length === 0 ? (
          <EmptyState
            illustration={<Users className="size-10" />}
            title={t('no_members')}
          />
        ) : (
          <div className="rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    {t('column_member')}
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    {t('column_role')}
                  </th>
                  <th className="hidden px-4 py-2.5 text-left font-medium text-muted-foreground md:table-cell">
                    {t('column_joined')}
                  </th>
                  <th className="hidden px-4 py-2.5 text-left font-medium text-muted-foreground lg:table-cell">
                    {t('column_last_login')}
                  </th>
                  {canManage && (
                    <th className="w-10 px-4 py-2.5 text-right font-medium text-muted-foreground">
                      <span className="sr-only">{t('column_actions')}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {accepted.map((member) => (
                  <tr key={member.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {member.user.full_name ?? member.user.email}
                      </div>
                      {member.user.full_name && (
                        <div className="text-xs text-muted-foreground">{member.user.email}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={ROLE_VARIANT[member.role]}>
                        {t(`role_${member.role}`)}
                      </Badge>
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                      {member.accepted_at ? formatDate(member.accepted_at) : '—'}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                      {member.lastSignInAt ? formatDate(member.lastSignInAt) : t('last_login_never')}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <MemberActions
                          membershipId={member.id}
                          currentRole={member.role}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Pending invites */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t('pending_invites_title')}
        </h2>

        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('no_pending_invites')}</p>
        ) : (
          <div className="rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    {t('column_member')}
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    {t('column_role')}
                  </th>
                  <th className="hidden px-4 py-2.5 text-left font-medium text-muted-foreground md:table-cell">
                    {t('invited_date')}
                  </th>
                  {canManage && (
                    <th className="w-10 px-4 py-2.5 text-right font-medium text-muted-foreground">
                      <span className="sr-only">{t('column_actions')}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {pending.map((member) => (
                  <tr key={member.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-medium">{member.user.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={ROLE_VARIANT[member.role]}>
                        {t(`role_${member.role}`)}
                      </Badge>
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                      {formatDate(member.invited_at)}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <MemberActions
                          membershipId={member.id}
                          currentRole={member.role}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
