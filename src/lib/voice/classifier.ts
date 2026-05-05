/**
 * Transcript outcome classifier.
 *
 * Uses OpenAI gpt-4o-mini with structured JSON output to infer the call
 * outcome from the final transcript.  This is the *inferred* path — it only
 * runs when no tool-driven outcome has already been set by the LLM during the
 * call (spec §8.5).
 *
 * The model returns one of the DB `call_outcome` enum values together with a
 * confidence score and a brief reasoning string for auditing.
 */

import { env } from '@/lib/env';

import type { TranscriptSegment } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CallOutcome =
  | 'interested'
  | 'not_interested'
  | 'appointment_booked'
  | 'wrong_number'
  | 'callback_requested'
  | 'voicemail_left'
  | 'do_not_call';

export const CALL_OUTCOME_VALUES: readonly CallOutcome[] = [
  'interested',
  'not_interested',
  'appointment_booked',
  'wrong_number',
  'callback_requested',
  'voicemail_left',
  'do_not_call',
] as const;

export interface ClassificationResult {
  outcome: CallOutcome;
  /** Probability that the classification is correct, in the range [0.0, 1.0]. */
  confidence: number;
  /** Brief English explanation (≤ 2 sentences) for auditing purposes. */
  reasoning: string;
}

// ─── OpenAI response shape ─────────────────────────────────────────────────

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

// ─── Classifier ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a call outcome classifier for an Italian automotive dealership outbound call centre.

Analyse the provided call transcript and classify the outcome using EXACTLY one of the following values:
- "interested": caller showed genuine interest but no appointment was confirmed
- "not_interested": caller explicitly declined or showed no interest
- "appointment_booked": an appointment was confirmed during the conversation
- "wrong_number": caller is not the intended contact or does not know who the business is trying to reach
- "callback_requested": caller asked to be called back at a different time
- "voicemail_left": the call reached voicemail and a message was left
- "do_not_call": caller explicitly asked to be removed from the contact list

Return a JSON object with these fields:
- outcome: one of the exact strings listed above
- confidence: a number between 0.0 (no confidence) and 1.0 (certain)
- reasoning: a brief English explanation (maximum 2 sentences) of why you chose that outcome`;

/**
 * Classifies the outcome of a call from its transcript segments.
 *
 * @throws {Error} when OPENAI_API_KEY is not configured or the API call fails.
 */
export async function classifyTranscript(
  transcript: TranscriptSegment[],
): Promise<ClassificationResult> {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured — cannot classify transcript');
  }

  const fullText =
    transcript.length > 0
      ? transcript
          .map((s) => `[${s.speaker === 'agent' ? 'Agent' : 'Caller'}]: ${s.text}`)
          .join('\n')
      : '(empty transcript)';

  const requestBody = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Call transcript:\n\n${fullText}` },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'call_outcome',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            outcome: {
              type: 'string',
              enum: CALL_OUTCOME_VALUES,
            },
            confidence: { type: 'number' },
            reasoning: { type: 'string' },
          },
          required: ['outcome', 'confidence', 'reasoning'],
          additionalProperties: false,
        },
      },
    },
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  const json = (await response.json()) as OpenAIChatResponse;
  const content = json.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Empty response content from OpenAI');
  }

  let parsed: ClassificationResult;
  try {
    parsed = JSON.parse(content) as ClassificationResult;
  } catch {
    throw new Error(`Failed to parse OpenAI classifier response: ${content.slice(0, 200)}`);
  }

  // Clamp confidence to [0, 1] in case the model returns an out-of-range value
  parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));

  return parsed;
}
