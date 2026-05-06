/**
 * Inbound IVR opt-out tool (plan 10 task 9).
 *
 * Invoked by the inbound assistant when the caller presses `1` (or asks to be
 * removed verbally). The runtime side effect is implemented in
 * `src/lib/services/inbound_calls.ts#recordInboundOptout` and dispatched from
 * the Vapi webhook handler when a `function-call` event with this tool name
 * arrives — the export below is just the JSON Schema definition Vapi serves to
 * the LLM. The legacy `handleRegisterInboundOptout` stub is kept only so
 * existing imports compile; new code should not call it.
 */
export const registerInboundOptoutJsonSchema = {
  name: 'register_inbound_optout',
  description:
    "Invoca questo strumento quando l'interlocutore preme 1 sul menù IVR oppure chiede esplicitamente di non essere più contattato. Registra il numero come opt-out per tutte le concessionarie che lo hanno chiamato di recente.",
  parameters: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    required: ['callerNumber'],
    properties: {
      callerNumber: {
        type: 'string',
        pattern: '^\\+[1-9]\\d{7,14}$',
        description:
          "Numero E.164 del chiamante (es. +393401234567). Vapi lo passa nei metadati della chiamata.",
      },
    },
    additionalProperties: false,
  },
} as const;

export interface RegisterInboundOptoutArgs {
  callerNumber: string;
}

/**
 * Deprecated stub kept for backwards compatibility with the export surface.
 * The real wiring lives in `inbound_calls.ts#recordInboundOptout` and runs
 * from the Vapi webhook dispatcher.
 */
export async function handleRegisterInboundOptout(
  _callId: string,
  _args: RegisterInboundOptoutArgs,
): Promise<void> {
  // intentional no-op; see file header
}
