export const confirmAppointmentJsonSchema = {
  name: 'confirm_appointment',
  description:
    'Invoca questo strumento quando il contatto conferma esplicitamente l\'appuntamento esistente senza richiedere modifiche.',
  parameters: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    required: ['confirmation_text'],
    properties: {
      confirmation_text: {
        type: 'string',
        maxLength: 512,
        description:
          'Testo esatto pronunciato dal contatto che conferma l\'appuntamento (citazione testuale)',
      },
    },
    additionalProperties: false,
  },
} as const;

export interface ConfirmAppointmentArgs {
  confirmation_text: string;
}

/** Handler stub — wired to real persistence in plan 08. */
export async function handleConfirmAppointment(
  _orgId: string,
  _callId: string,
  _args: ConfirmAppointmentArgs,
): Promise<void> {
  // TODO(plan-08): mark appointment as confirmed in database
}
