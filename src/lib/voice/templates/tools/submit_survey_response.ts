export const submitSurveyResponseJsonSchema = {
  name: 'submit_survey_response',
  description:
    'Invoca questo strumento per registrare le risposte del contatto al questionario CSI. Chiamare al termine dell\'intervista con tutte le risposte raccolte.',
  parameters: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    required: ['overall_satisfaction'],
    properties: {
      overall_satisfaction: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description: 'Soddisfazione generale su scala 1–10',
      },
      sales_advisor_score: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description: 'Valutazione del consulente di vendita su scala 1–10 (opzionale)',
      },
      delivery_experience_score: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description: 'Valutazione dell\'esperienza di consegna su scala 1–10 (opzionale)',
      },
      service_quality_score: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description: 'Valutazione della qualità del servizio su scala 1–10 (opzionale)',
      },
      would_recommend: {
        type: 'boolean',
        description: 'Il contatto raccomanderebbe la concessionaria (opzionale)',
      },
      open_feedback: {
        type: 'string',
        maxLength: 1024,
        description: 'Commento libero espresso dal contatto (opzionale)',
      },
    },
    additionalProperties: false,
  },
} as const;

export interface SubmitSurveyResponseArgs {
  overall_satisfaction: number;
  sales_advisor_score?: number;
  delivery_experience_score?: number;
  service_quality_score?: number;
  would_recommend?: boolean;
  open_feedback?: string;
}

/** Handler stub — wired to real persistence in plan 08. */
export async function handleSubmitSurveyResponse(
  _orgId: string,
  _callId: string,
  _args: SubmitSurveyResponseArgs,
): Promise<void> {
  // TODO(plan-08): persist survey results to database and forward to manufacturer
}
