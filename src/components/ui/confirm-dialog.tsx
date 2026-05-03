'use client';

import * as React from 'react';

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
  /** Label for the confirm button. Defaults to "Conferma". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "Annulla". */
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
  confirmLabel = 'Conferma',
  cancelLabel = 'Annulla',
  onConfirm,
  loading = false,
}: ConfirmDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const isDisabled = loading || pending;

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
      setOpen(false);
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
          <AlertDialogCancel disabled={isDisabled}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isDisabled}
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
          >
            {pending ? 'Attendere…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
