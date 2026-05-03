import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MarketingFooter } from '../footer';
import { MarketingNav } from '../nav';

afterEach(cleanup);

describe('MarketingNav', () => {
  it('renders the logo with VoiceFlow text', () => {
    render(<MarketingNav />);
    expect(screen.getByRole('link', { name: /voiceflow home/i })).toBeTruthy();
    expect(screen.getByText('VoiceFlow')).toBeTruthy();
  });

  it('renders the Accedi CTA linking to /accedi', () => {
    render(<MarketingNav />);
    const accediLink = screen.getByRole('link', { name: /accedi/i });
    expect(accediLink).toBeTruthy();
    expect(accediLink.getAttribute('href')).toBe('/accedi');
  });

  it('renders the marketing nav landmark', () => {
    render(<MarketingNav />);
    expect(screen.getByTestId('marketing-nav')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: /navigazione marketing/i })).toBeTruthy();
  });
});

describe('MarketingFooter', () => {
  it('renders the copyright notice', () => {
    render(<MarketingFooter />);
    expect(screen.getByText(/voiceflow\. tutti i diritti riservati/i)).toBeTruthy();
  });

  it('renders Privacy Policy link', () => {
    render(<MarketingFooter />);
    const link = screen.getByRole('link', { name: /privacy policy/i });
    expect(link.getAttribute('href')).toBe('/privacy');
  });

  it('renders Termini di Servizio link', () => {
    render(<MarketingFooter />);
    const link = screen.getByRole('link', { name: /termini di servizio/i });
    expect(link.getAttribute('href')).toBe('/termini');
  });

  it('renders Cookie Policy link', () => {
    render(<MarketingFooter />);
    const link = screen.getByRole('link', { name: /cookie policy/i });
    expect(link.getAttribute('href')).toBe('/cookie');
  });

  it('renders the legal nav landmark', () => {
    render(<MarketingFooter />);
    expect(screen.getByTestId('marketing-footer')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: /link legali/i })).toBeTruthy();
  });
});
