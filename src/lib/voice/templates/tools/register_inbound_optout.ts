/**
 * Inbound IVR opt-out tool (plan 10 task 9).
 *
 * Invoked by the inbound assistant when the caller presses `1` (or asks to be
 * removed verbally). The handler is wired in plan 10 task 11 — it resolves the
 * caller's number against recent outbound calls and enrols the caller in the
 * matching orgs' `opt_out_registry` rows with source `inbound_ivr`.
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

/** Handler stub — wired to opt-out enrolment in plan 10 task 11. */
export async function handleRegisterInboundOptout(
  _callId: string,
  _args: RegisterInboundOptoutArgs,
): Promise<void> {
  // TODO(plan-10 task 11): resolve recent outbound calls to callerNumber and
  // enrol every matching org in opt_out_registry with source='inbound_ivr'.
}
