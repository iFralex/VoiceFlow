import { z } from 'zod';

const MAX_LEN = 256;

export const csiSurveySchema = z.object({
  dealership_name: z
    .string()
    .min(1, 'Campo obbligatorio')
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
  manufacturer_brand: z
    .string()
    .min(1, 'Campo obbligatorio')
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
  vehicle_model: z
    .string()
    .min(1, 'Campo obbligatorio')
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
  service_type: z.enum(['sales', 'service'], {
    error: 'Tipo di servizio non valido. Valori ammessi: sales, service',
  }),
  last_interaction_date: z
    .string()
    .min(1, 'Campo obbligatorio')
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
});

export type CsiSurveyVariables = z.infer<typeof csiSurveySchema>;

export const csiSurveyJsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: [
    'dealership_name',
    'manufacturer_brand',
    'vehicle_model',
    'service_type',
    'last_interaction_date',
  ],
  properties: {
    dealership_name: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Nome della concessionaria',
    },
    manufacturer_brand: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Casa madre / brand (es. BMW, Mercedes-Benz)',
    },
    vehicle_model: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Modello del veicolo (es. BMW Serie 3 320d)',
    },
    service_type: {
      type: 'string',
      enum: ['sales', 'service'],
      description: 'Tipo di interazione oggetto del sondaggio: sales (vendita) o service (assistenza)',
    },
    last_interaction_date: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Data ultima interazione con la concessionaria (es. 10 aprile 2026)',
    },
  },
  additionalProperties: false,
} as const;
