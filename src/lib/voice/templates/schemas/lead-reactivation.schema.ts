import { z } from 'zod';

// Italian time slot pattern: GG/MM HH:MM (e.g. "15/06 10:00")
const SLOT_PATTERN = /^\d{2}\/\d{2} \d{2}:\d{2}$/;
const MAX_LEN = 256;

export const leadReactivationSchema = z.object({
  dealership_name: z
    .string()
    .min(1, 'Campo obbligatorio')
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
  brand: z
    .string()
    .min(1, 'Campo obbligatorio')
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
  salesperson_first_name: z
    .string()
    .min(1, 'Campo obbligatorio')
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
  available_slots: z
    .array(
      z
        .string()
        .regex(SLOT_PATTERN, 'Formato richiesto: GG/MM HH:MM (es. 15/06 10:00)')
        .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
    )
    .min(1, 'Inserire almeno uno slot'),
  lead_origin_context: z
    .string()
    .min(1, 'Campo obbligatorio')
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
  incentive_to_offer: z
    .string()
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`)
    .optional(),
});

export type LeadReactivationVariables = z.infer<typeof leadReactivationSchema>;

export const leadReactivationJsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: [
    'dealership_name',
    'brand',
    'salesperson_first_name',
    'available_slots',
    'lead_origin_context',
  ],
  properties: {
    dealership_name: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Nome della concessionaria',
    },
    brand: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Marca/brand automobilistico (es. Volkswagen, BMW)',
    },
    salesperson_first_name: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Nome del commerciale di riferimento',
    },
    available_slots: {
      type: 'array',
      items: {
        type: 'string',
        pattern: '^\\d{2}/\\d{2} \\d{2}:\\d{2}$',
        maxLength: 256,
        description: 'Slot in formato GG/MM HH:MM (es. 15/06 10:00)',
      },
      minItems: 1,
      description: 'Elenco degli slot disponibili per appuntamento',
    },
    lead_origin_context: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Contesto di origine del lead (es. richiesta info online per Golf GTI)',
    },
    incentive_to_offer: {
      type: 'string',
      maxLength: 256,
      description: 'Incentivo da proporre (opzionale, es. sconto di €1.500 valido fino a fine mese)',
    },
  },
  additionalProperties: false,
} as const;
