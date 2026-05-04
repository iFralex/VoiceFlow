import { z } from 'zod';

const MAX_LEN = 256;

export const appointmentConfirmSchema = z.object({
  dealership_name: z
    .string()
    .min(1, 'Campo obbligatorio')
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
  appointment_date: z
    .string()
    .min(1, 'Campo obbligatorio')
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
  appointment_time: z
    .string()
    .min(1, 'Campo obbligatorio')
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
  service_type: z.enum(['test_drive', 'service_appointment', 'delivery'], {
    error: 'Tipo di servizio non valido. Valori ammessi: test_drive, service_appointment, delivery',
  }),
  vehicle_model: z
    .string()
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`)
    .optional(),
  salesperson_first_name: z
    .string()
    .min(1, 'Campo obbligatorio')
    .max(MAX_LEN, `Massimo ${MAX_LEN} caratteri`),
});

export type AppointmentConfirmVariables = z.infer<typeof appointmentConfirmSchema>;

export const appointmentConfirmJsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: [
    'dealership_name',
    'appointment_date',
    'appointment_time',
    'service_type',
    'salesperson_first_name',
  ],
  properties: {
    dealership_name: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Nome della concessionaria',
    },
    appointment_date: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Data appuntamento (es. lunedì 12 maggio 2026)',
    },
    appointment_time: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Ora appuntamento (es. 10:30)',
    },
    service_type: {
      type: 'string',
      enum: ['test_drive', 'service_appointment', 'delivery'],
      description: 'Tipo di servizio: test_drive, service_appointment o delivery',
    },
    vehicle_model: {
      type: 'string',
      maxLength: 256,
      description: 'Modello del veicolo (opzionale, es. Volkswagen Golf 8)',
    },
    salesperson_first_name: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Nome del commerciale di riferimento',
    },
  },
  additionalProperties: false,
} as const;
