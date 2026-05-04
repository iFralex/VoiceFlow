import { z } from 'zod';

const MAX_LEN = 256;

export const postSaleFollowupSchema = z.object({
  dealership_name: z
    .string()
    .min(1, 'Campo obbligatorio')
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
  vehicle_model: z
    .string()
    .min(1, 'Campo obbligatorio')
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
  delivery_date: z
    .string()
    .min(1, 'Campo obbligatorio')
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
  salesperson_first_name: z
    .string()
    .min(1, 'Campo obbligatorio')
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
  service_reminder_window: z.enum(['3 mesi', '6 mesi', '12 mesi'], {
    error: 'Finestra di promemoria non valida. Valori ammessi: 3 mesi, 6 mesi, 12 mesi',
  }),
});

export type PostSaleFollowupVariables = z.infer<typeof postSaleFollowupSchema>;

export const postSaleFollowupJsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: [
    'dealership_name',
    'vehicle_model',
    'delivery_date',
    'salesperson_first_name',
    'service_reminder_window',
  ],
  properties: {
    dealership_name: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Nome della concessionaria',
    },
    vehicle_model: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Modello del veicolo acquistato (es. Audi A3 Sportback 35 TFSI)',
    },
    delivery_date: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Data di consegna del veicolo (es. 15 aprile 2026)',
    },
    salesperson_first_name: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Nome del commerciale che ha gestito la vendita',
    },
    service_reminder_window: {
      type: 'string',
      enum: ['3 mesi', '6 mesi', '12 mesi'],
      description: 'Finestra temporale per il promemoria tagliando: 3 mesi, 6 mesi o 12 mesi',
    },
  },
  additionalProperties: false,
} as const;
