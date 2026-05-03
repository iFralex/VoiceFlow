import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { organizations } from './organizations';
import { calls } from './calls';
import { contacts } from './contacts';

export const appointmentStatusEnum = pgEnum('appointment_status', [
  'booked',
  'confirmed',
  'cancelled',
  'no_show',
  'completed',
]);

export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    org_id: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    call_id: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    contact_id: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    scheduled_at: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    notes: text('notes'),
    status: appointmentStatusEnum('status').notNull().default('booked'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('appointments_org_scheduled_at_idx').on(t.org_id, t.scheduled_at),
  ],
);

export type Appointment = typeof appointments.$inferSelect;
export type NewAppointment = typeof appointments.$inferInsert;
