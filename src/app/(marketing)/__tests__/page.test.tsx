import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import MarketingPage from '../page';

afterEach(cleanup);

describe('MarketingPage (landing)', () => {
  it('renders the hero section', () => {
    render(<MarketingPage />);
    expect(screen.getByTestId('landing-hero')).toBeTruthy();
  });

  it('renders the hero title from i18n', () => {
    render(<MarketingPage />);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    // The mock returns the key path, so it contains the key name
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBeTruthy();
  });

  it('renders two hero CTA buttons', () => {
    render(<MarketingPage />);
    const links = screen.getAllByRole('link');
    // Should have primary and secondary CTA links in the hero area
    const heroCtas = links.filter(
      (l) =>
        l.getAttribute('href') === '/registrati' ||
        l.getAttribute('href') === '/come-funziona',
    );
    expect(heroCtas).toHaveLength(2);
  });

  it('renders the value props section with three cards', () => {
    render(<MarketingPage />);
    expect(screen.getByTestId('landing-value-props')).toBeTruthy();
    expect(screen.getByTestId('value-prop-vp1')).toBeTruthy();
    expect(screen.getByTestId('value-prop-vp2')).toBeTruthy();
    expect(screen.getByTestId('value-prop-vp3')).toBeTruthy();
  });

  it('renders three value prop headings', () => {
    render(<MarketingPage />);
    const h3s = screen.getAllByRole('heading', { level: 3 });
    expect(h3s).toHaveLength(3);
  });

  it('renders the pricing teaser section', () => {
    render(<MarketingPage />);
    expect(screen.getByTestId('landing-pricing')).toBeTruthy();
  });

  it('renders the pricing CTA link', () => {
    render(<MarketingPage />);
    const pricingSection = screen.getByTestId('landing-pricing');
    const link = pricingSection.querySelector('a');
    expect(link).toBeTruthy();
  });

  it('renders no lead capture form', () => {
    render(<MarketingPage />);
    expect(screen.queryByRole('form')).toBeNull();
  });
});
