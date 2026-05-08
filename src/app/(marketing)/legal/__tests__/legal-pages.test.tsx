import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import CookiePolicyPage from '../cookie/page';
import DpaPage from '../dpa/page';
import PrivacyPolicyPage from '../privacy/page';
import TermsPage from '../terms/page';

afterEach(cleanup);

describe('Legal — Privacy Policy page', () => {
  it('renders the privacy testid container', async () => {
    render(await PrivacyPolicyPage());
    expect(screen.getByTestId('legal-privacy')).toBeTruthy();
  });

  it('renders the Italian title heading', async () => {
    render(await PrivacyPolicyPage());
    expect(
      screen.getByRole('heading', { level: 1, name: /informativa sulla privacy/i }),
    ).toBeTruthy();
  });

  it('renders the data subject rights section', async () => {
    render(await PrivacyPolicyPage());
    expect(screen.getByRole('heading', { level: 2, name: /diritti dell.?interessato/i })).toBeTruthy();
  });

  it('renders the draft notice', async () => {
    render(await PrivacyPolicyPage());
    expect(screen.getByText(/documento in bozza/i)).toBeTruthy();
  });

  it('links back to the home page', async () => {
    render(await PrivacyPolicyPage());
    const backLink = screen.getByRole('link', { name: /torna alla home/i });
    expect(backLink.getAttribute('href')).toBe('/');
  });
});

describe('Legal — DPA page', () => {
  it('renders the dpa testid container', async () => {
    render(await DpaPage());
    expect(screen.getByTestId('legal-dpa')).toBeTruthy();
  });

  it('renders the DPA title heading', async () => {
    render(await DpaPage());
    expect(
      screen.getByRole('heading', { level: 1, name: /accordo sul trattamento dei dati/i }),
    ).toBeTruthy();
  });

  it('renders the current DPA version label', async () => {
    render(await DpaPage());
    expect(screen.getByText(/versione dpa/i)).toBeTruthy();
  });

  it('renders the breach notification section', async () => {
    render(await DpaPage());
    expect(screen.getByRole('heading', { level: 2, name: /notifica di violazione/i })).toBeTruthy();
  });
});

describe('Legal — Terms of Service page', () => {
  it('renders the terms testid container', async () => {
    render(await TermsPage());
    expect(screen.getByTestId('legal-terms')).toBeTruthy();
  });

  it('renders the Terms title heading', async () => {
    render(await TermsPage());
    expect(screen.getByRole('heading', { level: 1, name: /termini di servizio/i })).toBeTruthy();
  });

  it('renders the acceptable-use section', async () => {
    render(await TermsPage());
    expect(screen.getByRole('heading', { level: 2, name: /uso accettabile/i })).toBeTruthy();
  });
});

describe('Legal — Cookie Policy page', () => {
  it('renders the cookie testid container', async () => {
    render(await CookiePolicyPage());
    expect(screen.getByTestId('legal-cookie')).toBeTruthy();
  });

  it('renders the Cookie Policy heading', async () => {
    render(await CookiePolicyPage());
    expect(screen.getByRole('heading', { level: 1, name: /cookie policy/i })).toBeTruthy();
  });

  it('renders the cookie consent section', async () => {
    render(await CookiePolicyPage());
    expect(screen.getByRole('heading', { level: 2, name: /^3\. consenso$/i })).toBeTruthy();
  });
});
