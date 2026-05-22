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
          <p className="text-muted-foreground text-sm">{t('members_description')}</p>
        </div>
        {canInvite && <InviteMemberDialog />}
      </div>

      {/* Active members */}
      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          {t('accepted_members_title')}
        </h2>

        {accepted.length === 0 ? (
          <EmptyState illustration={<Users className="size-10" />} title={t('no_members')} />
        ) : (
          <div className="rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-muted-foreground px-4 py-2.5 text-left font-medium">
                    {t('column_member')}
                  </th>
                  <th className="text-muted-foreground px-4 py-2.5 text-left font-medium">
                    {t('column_role')}
                  </th>
                  <th className="text-muted-foreground hidden px-4 py-2.5 text-left font-medium md:table-cell">
                    {t('column_joined')}
                  </th>
                  <th className="text-muted-foreground hidden px-4 py-2.5 text-left font-medium lg:table-cell">
                    {t('column_last_login')}
                  </th>
                  {canManage && (
                    <th className="text-muted-foreground w-10 px-4 py-2.5 text-right font-medium">
                      <span className="sr-only">{t('column_actions')}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {accepted.map((member) => (
                  <tr key={member.id} className="hover:bg-muted/30 border-b last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {member.user.full_name ?? member.user.email}
                      </div>
                      {member.user.full_name && (
                        <div className="text-muted-foreground text-xs">{member.user.email}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={ROLE_VARIANT[member.role]}>{t(`role_${member.role}`)}</Badge>
                    </td>
                    <td className="text-muted-foreground hidden px-4 py-3 md:table-cell">
                      {member.accepted_at ? formatDate(member.accepted_at) : '—'}
                    </td>
                    <td className="text-muted-foreground hidden px-4 py-3 lg:table-cell">
                      {member.lastSignInAt
                        ? formatDate(member.lastSignInAt)
                        : t('last_login_never')}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <MemberActions membershipId={member.id} currentRole={member.role} />
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
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          {t('pending_invites_title')}
        </h2>

        {pending.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('no_pending_invites')}</p>
        ) : (
          <div className="rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-muted-foreground px-4 py-2.5 text-left font-medium">
                    {t('column_member')}
                  </th>
                  <th className="text-muted-foreground px-4 py-2.5 text-left font-medium">
                    {t('column_role')}
                  </th>
                  <th className="text-muted-foreground hidden px-4 py-2.5 text-left font-medium md:table-cell">
                    {t('invited_date')}
                  </th>
                  {canManage && (
                    <th className="text-muted-foreground w-10 px-4 py-2.5 text-right font-medium">
                      <span className="sr-only">{t('column_actions')}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {pending.map((member) => (
                  <tr key={member.id} className="hover:bg-muted/30 border-b last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{member.user.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={ROLE_VARIANT[member.role]}>{t(`role_${member.role}`)}</Badge>
                    </td>
                    <td className="text-muted-foreground hidden px-4 py-3 md:table-cell">
                      {formatDate(member.invited_at)}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <MemberActions membershipId={member.id} currentRole={member.role} />
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
