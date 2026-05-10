export const ALLOWED_EVENT_TYPES = [
  'call.completed',
  'call.failed',
  'appointment.booked',
  'campaign.completed',
  'contact.opted_out',
  'lead.qualified',
] as const;

export type WebhookEventType = (typeof ALLOWED_EVENT_TYPES)[number];
