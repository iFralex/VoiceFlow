/**
 * AI Act disclosure verification helper.
 *
 * Checks whether the required disclosure phrase ("assistente vocale automatico")
 * appears within the first 30 seconds of a call transcript.  This is the
 * second layer of the three-layer AI Act enforcement described in spec §12.3.
 *
 * Pure function — no side effects, safe to call at any layer.
 */

import type { TranscriptSegment } from './types';

/** The phrase that must be spoken within the first 30 seconds of the call. */
export const DISCLOSURE_PHRASE = 'assistente vocale automatico';

/** Cutoff in milliseconds for the "first 30 seconds" window. */
export const DISCLOSURE_WINDOW_MS = 30_000;

/**
 * Returns `true` when the disclosure phrase is detected in the opening window
 * of the transcript, `false` when it is absent.
 *
 * The check is case-insensitive and covers segments whose `startMs` falls at or
 * before 30 000 ms.
 */
export function checkDisclosure(segments: TranscriptSegment[]): boolean {
  const earlyText = segments
    .filter((s) => s.startMs <= DISCLOSURE_WINDOW_MS)
    .map((s) => s.text)
    .join(' ');

  return earlyText.toLowerCase().includes(DISCLOSURE_PHRASE);
}
