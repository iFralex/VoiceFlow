export const transferToHumanAgentJsonSchema = {
  name: 'transfer_to_human_agent',
  description:
    'Invoca questo strumento per trasferire la chiamata a un operatore umano. Usa quando il contatto lo richiede esplicitamente o quando la situazione supera le capacità dell\'assistente automatico.',
  parameters: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    required: ['reason'],
    properties: {
      reason: {
        type: 'string',
        maxLength: 256,
        description: 'Motivo del trasferimento a un operatore umano',
      },
    },
    additionalProperties: false,
  },
} as const;

export interface TransferToHumanAgentArgs {
  reason: string;
}

/** Handler stub — wired to real persistence in plan 08. */
export async function handleTransferToHumanAgent(
  _orgId: string,
  _callId: string,
  _args: TransferToHumanAgentArgs,
): Promise<void> {
  // TODO(plan-08): initiate SIP transfer or notify human agent queue
}
