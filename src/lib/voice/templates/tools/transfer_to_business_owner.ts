/**
 * Inbound IVR transfer tool (plan 10 task 9).
 *
 * Invoked by the inbound assistant when the caller presses `2`. The handler
 * (wired in plan 10 task 11) looks up the most recent outbound call to the
 * caller's number, finds the associated org, and transfers the call to that
 * org's configured `transfer_target_phone`. If no org or no transfer target is
 * available the IVR plays the "Nessun operatore disponibile" message instead.
 */
export const transferToBusinessOwnerJsonSchema = {
  name: 'transfer_to_business_owner',
  description:
    "Invoca questo strumento quando l'interlocutore preme 2 sul menù IVR oppure chiede di parlare con un operatore. Trasferisce la chiamata al recapito configurato dalla concessionaria che ha effettuato la chiamata uscente più recente verso questo numero.",
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

export interface TransferToBusinessOwnerArgs {
  callerNumber: string;
}

export type TransferToBusinessOwnerResult =
  | { ok: true; transferredTo: string }
  | { ok: false; reason: 'no_recent_call' | 'no_transfer_target' };

/** Handler stub — wired to transfer routing in plan 10 task 11. */
export async function handleTransferToBusinessOwner(
  _callId: string,
  _args: TransferToBusinessOwnerArgs,
): Promise<TransferToBusinessOwnerResult> {
  // TODO(plan-10 task 11): resolve most recent outbound call → org →
  // transfer_target_phone, then trigger the SIP transfer via Vapi.
  return { ok: false, reason: 'no_recent_call' };
}
