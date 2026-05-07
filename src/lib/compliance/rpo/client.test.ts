import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RpoIntermediaryClient, RpoMockClient, getRpoClient } from './client';

describe('RpoIntermediaryClient', () => {
  const ENDPOINT = 'https://rpo.example.com';
  const API_KEY = 'test-key-123';

  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns empty map when given no numbers', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const client = new RpoIntermediaryClient(ENDPOINT, API_KEY);
    const result = await client.bulkCheck([]);
    expect(result.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs to /bulk-check with bearer auth and parses results', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { phone: '+390212345678', blocked: true },
            { phone: '+393331234567', blocked: false },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const client = new RpoIntermediaryClient(ENDPOINT, API_KEY);
    const result = await client.bulkCheck(['+390212345678', '+393331234567']);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`${ENDPOINT}/bulk-check`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(init.body)).toEqual({ phones: ['+390212345678', '+393331234567'] });
    expect(result.get('+390212345678')).toBe(true);
    expect(result.get('+393331234567')).toBe(false);
  });

  it('chunks large requests into multiple bulk-check calls', async () => {
    const numbers = Array.from({ length: 1200 }, (_, i) => {
      const padded = String(i).padStart(8, '0');
      return `+39${padded.slice(0, 10)}`;
    });
    const fetchSpy = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { phones: string[] };
      return new Response(
        JSON.stringify({
          results: body.phones.map((p) => ({ phone: p, blocked: false })),
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchSpy);

    const client = new RpoIntermediaryClient(ENDPOINT, API_KEY);
    const result = await client.bulkCheck(numbers);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result.size).toBe(1200);
  });

  it('throws on non-2xx bulk-check response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 })),
    );
    const client = new RpoIntermediaryClient(ENDPOINT, API_KEY);
    await expect(client.bulkCheck(['+390212345678'])).rejects.toThrow(/403/);
  });

  it('rejects malformed phone numbers before calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const client = new RpoIntermediaryClient(ENDPOINT, API_KEY);
    await expect(client.bulkCheck(['not-a-phone'])).rejects.toThrow(/Invalid E\.164/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('GETs /check for singleCheck and returns parsed result', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ blocked: true, checked_at: '2026-05-07T12:00:00Z' }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const client = new RpoIntermediaryClient(ENDPOINT, API_KEY);
    const out = await client.singleCheck('+390212345678');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`${ENDPOINT}/check?phone=%2B390212345678`);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(out.isBlocked).toBe(true);
    expect(out.checkedAt.toISOString()).toBe('2026-05-07T12:00:00.000Z');
  });

  it('throws on non-2xx single-check response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('boom', { status: 500 })),
    );
    const client = new RpoIntermediaryClient(ENDPOINT, API_KEY);
    await expect(client.singleCheck('+390212345678')).rejects.toThrow(/500/);
  });
});

describe('RpoMockClient', () => {
  it('returns deterministic results for the same number', async () => {
    const client = new RpoMockClient();
    const a = await client.singleCheck('+390212345678');
    const b = await client.singleCheck('+390212345678');
    expect(a.isBlocked).toBe(b.isBlocked);
  });

  it('produces a low (< 20%) block rate over a representative sample', async () => {
    const client = new RpoMockClient();
    // Use varied prefixes so the input isn't a pure linear sequence; this
    // gives the cheap multiplicative hash a representative spread.
    const prefixes = ['+393', '+394', '+395', '+396', '+397', '+398', '+399'];
    const numbers: string[] = [];
    for (const prefix of prefixes) {
      for (let i = 0; i < 500; i += 1) {
        numbers.push(`${prefix}${String(i * 7919 + 1234567).padStart(8, '0').slice(0, 8)}`);
      }
    }
    const out = await client.bulkCheck(numbers);
    const blocked = Array.from(out.values()).filter(Boolean).length;
    const rate = blocked / numbers.length;
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThan(0.2);
  });

  it('rejects malformed phone numbers', async () => {
    const client = new RpoMockClient();
    await expect(client.bulkCheck(['nope'])).rejects.toThrow(/Invalid E\.164/);
    await expect(client.singleCheck('nope')).rejects.toThrow(/Invalid E\.164/);
  });
});

describe('getRpoClient factory', () => {
  const env = process.env as Record<string, string | undefined>;
  const originalEndpoint = env['RPO_PROVIDER_ENDPOINT'];
  const originalKey = env['RPO_PROVIDER_API_KEY'];
  const originalNodeEnv = env['NODE_ENV'];

  afterEach(() => {
    env['RPO_PROVIDER_ENDPOINT'] = originalEndpoint;
    env['RPO_PROVIDER_API_KEY'] = originalKey;
    env['NODE_ENV'] = originalNodeEnv;
    vi.resetModules();
  });

  it('returns mock client in development when credentials are absent', async () => {
    env['NODE_ENV'] = 'development';
    delete env['RPO_PROVIDER_ENDPOINT'];
    delete env['RPO_PROVIDER_API_KEY'];
    vi.resetModules();
    const mod = await import('./client');
    const client = mod.getRpoClient();
    expect(client).toBeInstanceOf(mod.RpoMockClient);
  });

  it('returns intermediary client in development when credentials are present', async () => {
    env['NODE_ENV'] = 'development';
    env['RPO_PROVIDER_ENDPOINT'] = 'https://sandbox.rpo.example.com';
    env['RPO_PROVIDER_API_KEY'] = 'sandbox-key';
    vi.resetModules();
    const mod = await import('./client');
    const client = mod.getRpoClient();
    expect(client).toBeInstanceOf(mod.RpoIntermediaryClient);
  });

  it('throws in production when credentials are missing', async () => {
    env['NODE_ENV'] = 'production';
    delete env['RPO_PROVIDER_ENDPOINT'];
    delete env['RPO_PROVIDER_API_KEY'];
    vi.resetModules();
    const mod = await import('./client');
    expect(() => mod.getRpoClient()).toThrow(/must be configured in production/);
  });

  it('exposes top-level getRpoClient export', () => {
    expect(typeof getRpoClient).toBe('function');
  });
});
