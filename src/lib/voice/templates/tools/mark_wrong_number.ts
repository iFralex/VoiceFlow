export const markWrongNumberJsonSchema = {
  name: 'mark_wrong_number',
  description:
    'Invoca questo strumento quando il contatto dichiara di non aver mai avuto rapporti con la concessionaria o che il numero è errato.',
  parameters: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    required: [],
    properties: {},
    additionalProperties: false,
  },
} as const;

export type MarkWrongNumberArgs = Record<string, never>;

/** Handler stub — wired to real persistence in plan 08. */
export async function handleMarkWrongNumber(
  _orgId: string,
  _callId: string,
  _args: MarkWrongNumberArgs,
): Promise<void> {
  // TODO(plan-08): flag contact as wrong number in database
}
