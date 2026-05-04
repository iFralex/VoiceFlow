import { z } from 'zod';

// Italian time slot pattern: GG/MM HH:MM (e.g. "15/06 10:00")
const SLOT_PATTERN = /^\d{2}\/\d{2} \d{2}:\d{2}$/;
const MAX_LEN = 256;

export const carRenewalSchema = z.object({
  dealership_name: z
    .string()
    .min(1, 'Campo obbligatorio')
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
  salesperson_first_name: z
    .string()
    .min(1, 'Campo obbligatorio')
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
  current_vehicle_model: z
    .string()
    .min(1, 'Campo obbligatorio')
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
  years_since_purchase: z
    .number()
    .int('Deve essere un numero intero')
    .min(1, 'Deve essere almeno 1 anno')
    .max(99, 'Valore non realistico'),
  available_slots: z
    .array(
      z
        .string()
        .regex(SLOT_PATTERN, 'Formato richiesto: GG/MM HH:MM (es. 15/06 10:00)')
        .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
    )
    .min(1, 'Inserire almeno uno slot'),
  trade_in_offer_summary: z
    .string()
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`)
    .optional(),
});

export type CarRenewalVariables = z.infer<typeof carRenewalSchema>;

export const carRenewalJsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: [
    'dealership_name',
    'salesperson_first_name',
    'current_vehicle_model',
    'years_since_purchase',
    'available_slots',
  ],
  properties: {
    dealership_name: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Nome della concessionaria',
    },
    salesperson_first_name: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Nome del commerciale di riferimento',
    },
    current_vehicle_model: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: "Modello dell'auto attuale (es. Volkswagen Golf 1.6 TDI)",
    },
    years_since_purchase: {
      type: 'integer',
      minimum: 1,
      maximum: 99,
      description: "Anni trascorsi dall'acquisto dell'auto attuale",
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
    trade_in_offer_summary: {
      type: 'string',
      maxLength: 256,
      description: "Riepilogo offerta permuta (opzionale, es. €12.000 garantiti per la sua Golf)",
    },
  },
  additionalProperties: false,
} as const;
