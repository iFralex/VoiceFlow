import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

const PROMPT_PATH = path.join(__dirname, 'inbound-ivr.txt');

describe('inbound-ivr prompt', () => {
  const content = fs.readFileSync(PROMPT_PATH, 'utf-8').trim();

  it('file exists and is non-empty', () => {
    expect(content.length).toBeGreaterThan(0);
  });

  it('contains the exact welcome script in spec §9 (Italian DTMF menu)', () => {
    // Plan 10 task 9 prescribes this exact greeting.
    expect(content).toContain(
      'Buongiorno, hai ricevuto una chiamata da questo numero. Premi 1 per non essere più contattato. Premi 2 per parlare con un operatore. Premi 9 per riascoltare.',
    );
  });

  it('mentions all three DTMF options (1, 2, 9) at least once each', () => {
    expect(content).toMatch(/Premi 1/);
    expect(content).toMatch(/Premi 2/);
    expect(content).toMatch(/Premi 9/);
  });

  it('references the inbound opt-out tool', () => {
    expect(content).toContain('register_inbound_optout');
  });

  it('references the operator-transfer tool', () => {
    expect(content).toContain('transfer_to_business_owner');
  });

  it('uses the capture_dtmf tool to read the keypress', () => {
    expect(content).toContain('capture_dtmf');
  });

  it('specifies an 8-second wait for input (per plan 10 task 9)', () => {
    expect(content.toLowerCase()).toContain('8 secondi');
  });

  it('plays the no-operator fallback message verbatim', () => {
    expect(content).toContain('Nessun operatore disponibile, riproveremo a chiamarti');
  });

  it('discloses AI identity when challenged', () => {
    expect(content.toLowerCase()).toContain('intelligenza artificiale');
  });

  it('does not contain unresolved Mustache placeholders (no per-call interpolation)', () => {
    // The inbound IVR is the same prompt for every DID — no per-call vars.
    expect(content).not.toMatch(/\{\{\w+\}\}/);
  });
});
