export const markNotInterestedJsonSchema = {
  name: 'mark_not_interested',
  description:
    'Invoca questo strumento quando il contatto ha chiaramente espresso disinteresse per l\'offerta o il prodotto.',
  parameters: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    required: [],
    properties: {
      reason: {
        type: 'string',
        maxLength: 256,
        description: 'Motivo del disinteresse espresso dal contatto (opzionale)',
      },
    },
    additionalProperties: false,
  },
} as const;

export interface MarkNotInterestedArgs {
  reason?: string;
}

/** Handler stub — wired to real persistence in plan 08. */
export async function handleMarkNotInterested(
  _orgId: string,
  _callId: string,
  _args: MarkNotInterestedArgs,
): Promise<void> {
  // TODO(plan-08): update call outcome in database
}
