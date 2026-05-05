import { describe, expect, it } from 'vitest';

import { checkDisclosure, DISCLOSURE_PHRASE, DISCLOSURE_WINDOW_MS } from './disclosure';
import type { TranscriptSegment } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seg(speaker: 'agent' | 'caller', text: string, startMs: number, endMs: number): TranscriptSegment {
  return { speaker, text, startMs, endMs };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('checkDisclosure', () => {
  it('returns true when the disclosure phrase is present within 30 seconds', () => {
    const segments = [
      seg('agent', 'Buongiorno, sono un assistente vocale automatico della concessionaria.', 0, 5000),
      seg('caller', 'Ciao.', 5100, 6000),
    ];
    expect(checkDisclosure(segments)).toBe(true);
  });

  it('returns true when the phrase is in mixed case', () => {
    const segments = [
      seg('agent', 'Sono un ASSISTENTE VOCALE AUTOMATICO.', 0, 3000),
    ];
    expect(checkDisclosure(segments)).toBe(true);
  });

  it('returns true when the phrase is split across words with surrounding text', () => {
    const segments = [
      seg('agent', 'Questo è un servizio: assistente vocale automatico per clienti.', 1000, 8000),
    ];
    expect(checkDisclosure(segments)).toBe(true);
  });

  it('returns false when the disclosure phrase is absent', () => {
    const segments = [
      seg('agent', 'Buongiorno, parlo con Mario Rossi?', 0, 2000),
      seg('caller', 'Sì, sono io.', 2100, 3500),
    ];
    expect(checkDisclosure(segments)).toBe(false);
  });

  it('returns false for an empty transcript', () => {
    expect(checkDisclosure([])).toBe(false);
  });

  it('ignores segments that start after the 30-second window', () => {
    // Disclosure phrase only appears after 30 000 ms — must return false
    const segments = [
      seg('agent', 'Buongiorno.', 0, 2000),
      seg('agent', 'Sono un assistente vocale automatico.', 30_001, 35_000),
    ];
    expect(checkDisclosure(segments)).toBe(false);
  });

  it('includes segments that start exactly at 30 000 ms', () => {
    const segments = [
      seg('agent', 'Sono un assistente vocale automatico.', DISCLOSURE_WINDOW_MS, 35_000),
    ];
    expect(checkDisclosure(segments)).toBe(true);
  });

  it('returns true when phrase spans multiple early segments', () => {
    // Phrase components are spread across two separate segments
    const segments = [
      seg('agent', 'assistente vocale', 1000, 3000),
      seg('agent', 'automatico — grazie.', 3100, 5000),
    ];
    expect(checkDisclosure(segments)).toBe(true);
  });

  it('does not match a partial phrase', () => {
    const segments = [
      seg('agent', 'assistente vocale della banca.', 0, 3000),
    ];
    expect(checkDisclosure(segments)).toBe(false);
  });

  it('exports the expected constants', () => {
    expect(DISCLOSURE_PHRASE).toBe('assistente vocale automatico');
    expect(DISCLOSURE_WINDOW_MS).toBe(30_000);
  });
});
