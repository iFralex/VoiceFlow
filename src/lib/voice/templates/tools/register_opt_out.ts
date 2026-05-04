export const registerOptOutJsonSchema = {
  name: 'register_opt_out',
  description:
    'Invoca questo strumento immediatamente quando il contatto chiede esplicitamente di non essere più contattato. Ha priorità assoluta su qualsiasi altra azione.',
  parameters: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    required: ['confirmation_text'],
    properties: {
      confirmation_text: {
        type: 'string',
        maxLength: 512,
        description:
          'Testo esatto pronunciato dal contatto che esprime la richiesta di opt-out (citazione testuale)',
      },
    },
    additionalProperties: false,
  },
} as const;

export interface RegisterOptOutArgs {
  confirmation_text: string;
}

/** Handler stub — wired to real persistence in plan 08. */
export async function handleRegisterOptOut(
  _orgId: string,
  _callId: string,
  _args: RegisterOptOutArgs,
): Promise<void> {
  // TODO(plan-08): persist opt-out to database and suppress future calls
}
