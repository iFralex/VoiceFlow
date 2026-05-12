'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface ConfirmDialogProps {
  /** The element that opens the dialog (e.g. a delete button). */
  trigger: React.ReactNode;
  /** Dialog title, e.g. "Elimina contatto". */
  title: string;
  /** Descriptive text explaining the consequence, e.g. "Questa operazione non può essere annullata." */
  description: string;
  /** Label for the confirm button. Defaults to the common.confirm translation. */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to the common.cancel translation. */
  cancelLabel?: string;
  /** Called when the user clicks the confirm button. */
  onConfirm: () => void | Promise<void>;
  /** Whether the confirm action is in progress (disables both buttons while pending). */
  loading?: boolean;
}

/**
 * Wraps any trigger in a destructive-action confirmation dialog.
 *
 * Usage:
 *   <ConfirmDialog
 *     trigger={<Button variant="destructive">Elimina</Button>}
 *     title="Elimina membro"
 *     description="Il membro perderà l'accesso all'organizzazione. Questa operazione non può essere annullata."
 *     onConfirm={handleDelete}
 *   />
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  loading = false,
}: ConfirmDialogProps) {
  const t = useTranslations('common');
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const confirmText = confirmLabel ?? t('confirm');
  const cancelText = cancelLabel ?? t('cancel');

  const isDisabled = loading || pending;

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('ConfirmDialog: onConfirm threw an error', err);
      const message = err instanceof Error ? err.message : t('error_generic');
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDisabled}>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isDisabled}
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
          >
            {pending ? t('loading') : confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
