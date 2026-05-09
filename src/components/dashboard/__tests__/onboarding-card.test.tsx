import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DashboardOnboardingCard } from '@/components/dashboard/onboarding-card';

afterEach(cleanup);

describe('DashboardOnboardingCard', () => {
  it('renders three guided steps with CTAs linking to onboarding flows', () => {
    const { container } = render(<DashboardOnboardingCard />);

    expect(screen.getByText('Inizia in 3 semplici passi')).toBeInTheDocument();

    const slotSteps = container.querySelectorAll(
      '[data-slot="dashboard-onboarding-step"]',
    );
    expect(slotSteps.length).toBe(3);

    const contactsLink = screen.getAllByRole('link', { name: /Carica contatti/i })[0]!;
    expect(contactsLink.getAttribute('href')).toBe('/contacts/upload');

    const scriptLink = screen.getAllByRole('link', { name: /Configura script/i })[0]!;
    expect(scriptLink.getAttribute('href')).toBe('/scripts');

    const campaignLink = screen.getAllByRole('link', { name: /Crea campagna/i })[0]!;
    expect(campaignLink.getAttribute('href')).toBe('/campaigns/new');
  });
});
