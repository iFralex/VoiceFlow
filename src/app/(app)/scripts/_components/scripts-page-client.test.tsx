import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SerializedScript, TemplateCard } from './scripts-page-client';
import { ScriptsPageClient } from './scripts-page-client';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/actions/scripts', () => ({
  deleteScript: vi.fn().mockResolvedValue({ ok: true }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TEMPLATE_CARDS: TemplateCard[] = [
  {
    slug: 'lead-reactivation',
    name: 'Riattivazione Lead',
    description: 'Riattivazione dei lead inattivi con proposta di appuntamento',
    requiredFields: [
      'dealership_name',
      'brand',
      'salesperson_first_name',
      'available_slots',
      'lead_origin_context',
    ],
  },
  {
    slug: 'appointment-confirm',
    name: 'Conferma Appuntamento',
    description: 'Conferma, modifica o cancellazione degli appuntamenti esistenti',
    requiredFields: [
      'dealership_name',
      'appointment_date',
      'appointment_time',
      'service_type',
      'salesperson_first_name',
    ],
  },
];

const SCRIPT_1: SerializedScript = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Script Volkswagen',
  template_slug: 'lead-reactivation',
  template_name: 'Riattivazione Lead',
  updated_at: '2026-04-01T10:00:00.000Z',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

afterEach(cleanup);

describe('ScriptsPageClient', () => {
  it('renders the page title', () => {
    render(<ScriptsPageClient templateCards={TEMPLATE_CARDS} scripts={[]} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Script' })).toBeInTheDocument();
  });

  it('renders all template cards', () => {
    render(<ScriptsPageClient templateCards={TEMPLATE_CARDS} scripts={[]} />);
    expect(screen.getByText('Riattivazione Lead')).toBeInTheDocument();
    expect(screen.getByText('Conferma Appuntamento')).toBeInTheDocument();
  });

  it('renders template descriptions', () => {
    render(<ScriptsPageClient templateCards={TEMPLATE_CARDS} scripts={[]} />);
    expect(
      screen.getByText('Riattivazione dei lead inattivi con proposta di appuntamento'),
    ).toBeInTheDocument();
  });

  it('renders required fields as monospace tags', () => {
    render(<ScriptsPageClient templateCards={TEMPLATE_CARDS} scripts={[]} />);
    // dealership_name appears in both template cards
    const dealershipFields = screen.getAllByText('dealership_name');
    expect(dealershipFields.length).toBeGreaterThanOrEqual(1);
    // brand is unique to lead-reactivation
    expect(screen.getByText('brand')).toBeInTheDocument();
  });

  it('renders a "Crea da questo template" button per card', () => {
    render(<ScriptsPageClient templateCards={TEMPLATE_CARDS} scripts={[]} />);
    const ctaButtons = screen.getAllByRole('link', { name: 'Crea da questo template' });
    expect(ctaButtons).toHaveLength(2);
    expect(ctaButtons[0]).toHaveAttribute('href', '/scripts/new?template=lead-reactivation');
  });

  it('shows empty state when there are no scripts', () => {
    render(<ScriptsPageClient templateCards={TEMPLATE_CARDS} scripts={[]} />);
    expect(
      screen.getByText('Nessuno script configurato — inizia da uno dei nostri template'),
    ).toBeInTheDocument();
  });

  it('renders the scripts table when scripts are present', () => {
    render(<ScriptsPageClient templateCards={TEMPLATE_CARDS} scripts={[SCRIPT_1]} />);
    expect(screen.getByText('Script Volkswagen')).toBeInTheDocument();
    // Does NOT show empty state
    expect(
      screen.queryByText('Nessuno script configurato — inizia da uno dei nostri template'),
    ).not.toBeInTheDocument();
  });

  it('renders action buttons for each script', () => {
    render(<ScriptsPageClient templateCards={TEMPLATE_CARDS} scripts={[SCRIPT_1]} />);
    const editLink = screen.getByRole('link', { name: 'Modifica' });
    expect(editLink).toHaveAttribute('href', `/scripts/${SCRIPT_1.id}`);
    expect(screen.getByRole('button', { name: 'Elimina' })).toBeInTheDocument();
  });

  it('renders the "I tuoi script" section heading', () => {
    render(<ScriptsPageClient templateCards={TEMPLATE_CARDS} scripts={[]} />);
    expect(screen.getByRole('heading', { level: 2, name: 'I tuoi script' })).toBeInTheDocument();
  });

  it('renders table column headers when scripts are present', () => {
    render(<ScriptsPageClient templateCards={TEMPLATE_CARDS} scripts={[SCRIPT_1]} />);
    expect(screen.getByText('Nome')).toBeInTheDocument();
    expect(screen.getByText('Template')).toBeInTheDocument();
    expect(screen.getByText('Ultimo aggiornamento')).toBeInTheDocument();
  });
});
