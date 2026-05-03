'use client';

import { MoreHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { removeMemberAction, updateMemberRoleAction } from '@/actions/membership';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toastResult } from '@/lib/utils/action-toast';
import type { MemberRole } from '@/types';

const ROLES: MemberRole[] = ['owner', 'admin', 'operator', 'viewer'];

interface MemberActionsProps {
  membershipId: string;
  currentRole: MemberRole;
}

export function MemberActions({ membershipId, currentRole }: MemberActionsProps) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const router = useRouter();
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<MemberRole>(currentRole);
  const [isRolePending, startRoleTransition] = useTransition();
  const [isRemovePending, startRemoveTransition] = useTransition();

  function handleRoleChange() {
    startRoleTransition(async () => {
      const result = await updateMemberRoleAction({ membershipId, role: selectedRole });
      toastResult(result);
      if (result.ok) {
        setRoleDialogOpen(false);
        router.refresh();
      }
    });
  }

  function handleRemove() {
    startRemoveTransition(async () => {
      const result = await removeMemberAction({ membershipId });
      toastResult(result);
      if (result.ok) {
        setRemoveDialogOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7">
            <MoreHorizontal className="size-4" />
            <span className="sr-only">{t('member_actions_label')}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRoleDialogOpen(true)}>
            {t('change_role')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setRemoveDialogOpen(true)}
          >
            {t('remove_member')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Change role dialog */}
      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('change_role_dialog_title')}</DialogTitle>
          </DialogHeader>
          <Select
            value={selectedRole}
            onValueChange={(v) => setSelectedRole(v as MemberRole)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {t(`role_${r}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRoleDialogOpen(false)}
              disabled={isRolePending}
            >
              {tc('cancel')}
            </Button>
            <Button onClick={handleRoleChange} disabled={isRolePending}>
              {isRolePending ? tc('loading') : t('change_role_submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove member confirmation */}
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('remove_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('remove_confirm_description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemovePending}>{tc('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isRemovePending}
              onClick={(e) => {
                e.preventDefault();
                handleRemove();
              }}
            >
              {isRemovePending ? tc('loading') : t('remove_member')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
