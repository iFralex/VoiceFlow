/**
 * Tool side-effect handlers for voice call tools.
 *
 * Each handler runs inside a `withOrgContext` transaction alongside the
 * `call.tool_invoked` audit record in `recordToolInvocation`. Inngest events
 * to be sent after the transaction commits are returned in `inngestEvents`.
 *
 * All handlers are idempotent: re-invoking with the same (callId, tool) is a
 * no-op. Outcome updates use `WHERE outcome IS NULL` guards; inserts use
 * `onConflictDoNothing()`.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';

import type { DbTx } from '@/lib/db/context';
import { appointments, calls, contacts } from '@/lib/db/schema';
import type { InngestEventPayload } from '@/lib/inngest/client';
import { APPOINTMENT_BOOKED_EVENT, CALL_TRANSFERRED_EVENT } from '@/lib/inngest/voice/events';
import { markOptOutInTx } from '@/lib/services/optout';

export { APPOINTMENT_BOOKED_EVENT, CALL_TRANSFERRED_EVENT };

// ─── Return type ─────────────────────────────────────────────────────────────

export interface ToolSideEffectResult {
  /** Events to emit via Inngest after the transaction commits. */
  inngestEvents: InngestEventPayload[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Loads the call's contact_id and phone number. Returns null if not found. */
async function loadCallContact(
  tx: DbTx,
  callId: string,
  orgId: string,
): Promise<{ contactId: string; phoneE164: string } | null> {
  const [callRow] = await tx
    .select({ contactId: calls.contact_id })
    .from(calls)
    .where(and(eq(calls.id, callId), eq(calls.org_id, orgId)))
    .limit(1);
  if (!callRow) return null;
  // Outbound campaign calls always have a contact_id; inbound rows do not.
  // Tool side-effects only fire on outbound calls, but guard explicitly so
  // the type narrows from `string | null` to `string`.
  if (callRow.contactId === null) return null;
  const contactId = callRow.contactId;

  const [contactRow] = await tx
    .select({ phoneE164: contacts.phone_e164 })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.org_id, orgId)))
    .limit(1);
  if (!contactRow) return null;

  return { contactId, phoneE164: contactRow.phoneE164 };
}

/**
 * Parses "YYYY-MM-DD" + "HH:MM" as Europe/Rome local time and returns the
 * corresponding UTC Date. Uses the Intl API to resolve the UTC offset for the
 * given date, correctly handling CET (UTC+1) and CEST (UTC+2) daylight saving.
 */
function parseScheduledAt(date: string, time: string): Date {
  // Step 1: treat the input as UTC to obtain a reference instant.
  const candidate = new Date(`${date}T${time}:00Z`);

  // Step 2: format that UTC instant as Europe/Rome local time.
  // sv-SE locale produces "YYYY-MM-DD HH:MM:SS" which is easy to re-parse.
  const romeStr = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(candidate);

  // Step 3: parse that Rome local time back as UTC to get the offset direction.
  const romeAsUtc = new Date(romeStr.replace(' ', 'T') + 'Z').getTime();

  // Step 4: subtract the offset to obtain the true UTC instant.
  // offset = romeAsUtc - candidateUtc = positive (Rome is ahead of UTC)
  const offset = romeAsUtc - candidate.getTime();
  return new Date(candidate.getTime() - offset);
}

// ─── Individual handlers ──────────────────────────────────────────────────────

async function runBookAppointment(
  tx: DbTx,
  orgId: string,
  callId: string,
  args: { date: string; time: string; contact_confirmation_text: string },
): Promise<ToolSideEffectResult> {
  const contact = await loadCallContact(tx, callId, orgId);
  if (!contact) return { inngestEvents: [] };

  // Idempotency: skip insert if an appointment for this call already exists
  const [existing] = await tx
    .select({ id: appointments.id })
    .from(appointments)
    .where(eq(appointments.call_id, callId))
    .limit(1);

  let appointmentId: string;
  if (existing) {
    appointmentId = existing.id;
  } else {
    const [inserted] = await tx
      .insert(appointments)
      .values({
        org_id: orgId,
        call_id: callId,
        contact_id: contact.contactId,
        scheduled_at: parseScheduledAt(args.date, args.time),
        notes: args.contact_confirmation_text,
        status: 'booked',
      })
      .returning({ id: appointments.id });
    appointmentId = inserted!.id;
  }

  await tx
    .update(calls)
    .set({ outcome: 'appointment_booked' })
    .where(and(eq(calls.id, callId), eq(calls.org_id, orgId), isNull(calls.outcome)));

  return {
    inngestEvents: [
      {
        name: APPOINTMENT_BOOKED_EVENT,
        data: { callId, orgId, appointmentId },
        id: `appointment-booked-${callId}`,
      },
      {
        name: 'webhook/emit',
        data: {
          orgId,
          eventType: 'appointment.booked',
          payload: { callId, orgId, appointmentId },
          dedupKey: callId,
        },
        id: `webhook-emit-appointment-booked-${callId}`,
      },
    ],
  };
}

async function runMarkNotInterested(
  tx: DbTx,
  orgId: string,
  callId: string,
  _args: { reason?: string },
): Promise<ToolSideEffectResult> {
  await tx
    .update(calls)
    .set({ outcome: 'not_interested' })
    .where(and(eq(calls.id, callId), eq(calls.org_id, orgId), isNull(calls.outcome)));

  return { inngestEvents: [] };
}

async function runMarkWrongNumber(
  tx: DbTx,
  orgId: string,
  callId: string,
  _args: Record<string, never>,
): Promise<ToolSideEffectResult> {
  await tx
    .update(calls)
    .set({ outcome: 'wrong_number' })
    .where(and(eq(calls.id, callId), eq(calls.org_id, orgId), isNull(calls.outcome)));

  // Flag the contact's metadata with wrong_number=true
  const [callRow] = await tx
    .select({ contactId: calls.contact_id })
    .from(calls)
    .where(and(eq(calls.id, callId), eq(calls.org_id, orgId)))
    .limit(1);

  if (callRow && callRow.contactId !== null) {
    await tx
      .update(contacts)
      .set({
        metadata: sql`COALESCE(${contacts.metadata}, '{}')::jsonb || '{"wrong_number": true}'::jsonb`,
      })
      .where(and(eq(contacts.id, callRow.contactId), eq(contacts.org_id, orgId)));
  }

  return { inngestEvents: [] };
}

async function runRequestCallback(
  tx: DbTx,
  orgId: string,
  callId: string,
  args: { preferred_window: string },
): Promise<ToolSideEffectResult> {
  await tx
    .update(calls)
    .set({
      outcome: 'callback_requested',
      metadata: sql`COALESCE(${calls.metadata}, '{}'::jsonb) || ${JSON.stringify({ callback_window: args.preferred_window })}::jsonb`,
    })
    .where(and(eq(calls.id, callId), eq(calls.org_id, orgId), isNull(calls.outcome)));

  return { inngestEvents: [] };
}

async function runTransferToHumanAgent(
  tx: DbTx,
  orgId: string,
  callId: string,
  args: { reason: string },
): Promise<ToolSideEffectResult> {
  await tx
    .update(calls)
    .set({ transferred_to_agent: true })
    .where(and(eq(calls.id, callId), eq(calls.org_id, orgId)));

  return {
    inngestEvents: [
      {
        name: CALL_TRANSFERRED_EVENT,
        data: { callId, orgId, reason: args.reason },
        id: `call-transferred-${callId}`,
      },
    ],
  };
}

async function runRegisterOptOut(
  tx: DbTx,
  orgId: string,
  callId: string,
  args: { confirmation_text: string },
): Promise<ToolSideEffectResult> {
  const contact = await loadCallContact(tx, callId, orgId);
  if (!contact) return { inngestEvents: [] };

  // Routes through the unified opt-out service so registry insert, contact
  // flag, audit log, and `compliance/opt-out-registered` event all stay in
  // sync. The LLM's confirmation_text is preserved as supplementary context
  // on the audit entry; `contacts.opt_out_reason` carries the source enum.
  const optOutEvents = await markOptOutInTx(tx, {
    orgId,
    phoneE164: contact.phoneE164,
    source: 'call_outcome',
    reason: args.confirmation_text,
    callId,
  });

  // Set call outcome — idempotent via NULL guard
  await tx
    .update(calls)
    .set({ outcome: 'do_not_call' })
    .where(and(eq(calls.id, callId), eq(calls.org_id, orgId), isNull(calls.outcome)));

  return { inngestEvents: optOutEvents };
}

async function runConfirmAppointment(
  tx: DbTx,
  orgId: string,
  callId: string,
  _args: { confirmation_text: string },
): Promise<ToolSideEffectResult> {
  await tx
    .update(appointments)
    .set({ status: 'confirmed' })
    .where(and(eq(appointments.call_id, callId), eq(appointments.org_id, orgId)));

  return { inngestEvents: [] };
}

async function runRescheduleAppointment(
  tx: DbTx,
  orgId: string,
  callId: string,
  args: { new_date: string; new_time: string; contact_confirmation_text: string },
): Promise<ToolSideEffectResult> {
  await tx
    .update(appointments)
    .set({
      scheduled_at: parseScheduledAt(args.new_date, args.new_time),
      status: 'booked',
      notes: args.contact_confirmation_text,
    })
    .where(and(eq(appointments.call_id, callId), eq(appointments.org_id, orgId)));

  return { inngestEvents: [] };
}

async function runSubmitSurveyResponse(
  tx: DbTx,
  orgId: string,
  callId: string,
  _args: unknown,
): Promise<ToolSideEffectResult> {
  // Survey responses are persisted in full in plan 14 (QA dashboard).
  // For now, mark the call outcome as 'interested' (survey completed).
  await tx
    .update(calls)
    .set({ outcome: 'interested' })
    .where(and(eq(calls.id, callId), eq(calls.org_id, orgId), isNull(calls.outcome)));

  return { inngestEvents: [] };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Dispatches a tool invocation to the appropriate side-effect handler.
 *
 * Must be called inside a `withOrgContext` transaction. Returns the list of
 * Inngest events the caller should emit after the transaction commits.
 */
export async function dispatchToolSideEffect(
  tx: DbTx,
  orgId: string,
  callId: string,
  tool: string,
  args: unknown,
): Promise<ToolSideEffectResult> {
  const a = (args ?? {}) as Record<string, unknown>;

  switch (tool) {
    case 'book_appointment':
      return runBookAppointment(
        tx,
        orgId,
        callId,
        a as { date: string; time: string; contact_confirmation_text: string },
      );

    case 'mark_not_interested':
      return runMarkNotInterested(tx, orgId, callId, a as { reason?: string });

    case 'mark_wrong_number':
      return runMarkWrongNumber(tx, orgId, callId, a as Record<string, never>);

    case 'request_callback':
      return runRequestCallback(tx, orgId, callId, a as { preferred_window: string });

    case 'transfer_to_human_agent':
      return runTransferToHumanAgent(tx, orgId, callId, a as { reason: string });

    case 'register_opt_out':
      return runRegisterOptOut(tx, orgId, callId, a as { confirmation_text: string });

    case 'confirm_appointment':
      return runConfirmAppointment(tx, orgId, callId, a as { confirmation_text: string });

    case 'reschedule_appointment':
      return runRescheduleAppointment(
        tx,
        orgId,
        callId,
        a as { new_date: string; new_time: string; contact_confirmation_text: string },
      );

    case 'submit_survey_response':
      return runSubmitSurveyResponse(tx, orgId, callId, a);

    default:
      // Unknown tool — audit record written by recordToolInvocation; no further side effects
      return { inngestEvents: [] };
  }
}
