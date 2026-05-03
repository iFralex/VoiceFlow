import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

afterEach(cleanup);

describe('ConfirmDialog', () => {
  function renderDialog(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
    const onConfirm = props.onConfirm ?? vi.fn();
    render(
      <ConfirmDialog
        trigger={<button>Open</button>}
        title="Elimina contatto"
        description="Questa operazione non può essere annullata."
        onConfirm={onConfirm}
        {...props}
      />,
    );
    return { onConfirm };
  }

  it('renders the trigger button', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });

  it('dialog is not visible until trigger is clicked', () => {
    renderDialog();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('opens dialog when trigger is clicked', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('shows title and description', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByText('Elimina contatto')).toBeInTheDocument();
    expect(screen.getByText('Questa operazione non può essere annullata.')).toBeInTheDocument();
  });

  it('shows default confirm and cancel labels', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('button', { name: 'Conferma' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annulla' })).toBeInTheDocument();
  });

  it('respects custom confirmLabel and cancelLabel', () => {
    renderDialog({ confirmLabel: 'Sì, elimina', cancelLabel: 'No, torna indietro' });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('button', { name: 'Sì, elimina' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No, torna indietro' })).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onConfirm });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conferma' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  });

  it('closes the dialog after confirm resolves', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onConfirm });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conferma' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('does not call onConfirm when cancel is clicked', () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('disables buttons when loading prop is true', () => {
    renderDialog({ loading: true });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('button', { name: 'Conferma' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Annulla' })).toBeDisabled();
  });
});
