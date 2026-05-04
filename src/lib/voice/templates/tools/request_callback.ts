export const requestCallbackJsonSchema = {
  name: 'request_callback',
  description:
    'Invoca questo strumento quando il contatto chiede di essere richiamato in un altro momento.',
  parameters: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    required: ['preferred_window'],
    properties: {
      preferred_window: {
        type: 'string',
        maxLength: 256,
        description:
          'Finestra oraria o data preferita per il richiamo, come indicata dal contatto (es. "domani mattina dopo le 10")',
      },
    },
    additionalProperties: false,
  },
} as const;

export interface RequestCallbackArgs {
  preferred_window: string;
}

/** Handler stub — wired to real persistence in plan 08. */
export async function handleRequestCallback(
  _orgId: string,
  _callId: string,
  _args: RequestCallbackArgs,
): Promise<void> {
  // TODO(plan-08): schedule callback task in the queue
}
