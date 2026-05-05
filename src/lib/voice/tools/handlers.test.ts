import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks (must be declared before any import of the module under test) ──────

vi.mock('@/lib/db/schema', () => ({
  calls: {
    id: 'id',
    org_id: 'org_id',
    contact_id: 'contact_id',
    outcome: 'outcome',
    transferred_to_agent: 'transferred_to_agent',
  },
  contacts: {
    id: 'id',
    org_id: 'org_id',
    phone_e164: 'phone_e164',
    opt_out: 'opt_out',
    opt_out_reason: 'opt_out_reason',
    metadata: 'metadata',
  },
  appointments: {
    id: 'id',
    call_id: 'call_id',
    org_id: 'org_id',
    contact_id: 'contact_id',
    scheduled_at: 'scheduled_at',
    notes: 'notes',
    status: 'status',
  },
  optOutRegistry: { id: 'id', org_id: 'org_id', phone_e164: 'phone_e164', source: 'source' },
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  isNull: (a: unknown) => ({ isNull: a }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.raw, values }),
}));

// ─── Module under test ────────────────────────────────────────────────────────

const { dispatchToolSideEffect } = await import('./handlers');

// ─── Mock transaction factory ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockTx: any;

function buildMockTx() {
  const selectQueue: unknown[][] = [];
  const insertedRows: unknown[] = [];
  const updatedSets: unknown[] = [];

  const makeSelectChain = (result: unknown[]) => {
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve(result)),
    };
    return chain;
  };

  const tx = {
    _selectQueue: selectQueue,
    _insertedRows: insertedRows,
    _updatedSets: updatedSets,

    select: vi.fn(() => makeSelectChain(selectQueue.shift() ?? [])),

    insert: vi.fn(() => ({
      values: vi.fn((row: unknown) => {
        insertedRows.push(row);
        return {
          returning: vi.fn(() =>
            Promise.resolve([{ id: 'new-appointment-id', ...(row as object) }]),
          ),
          onConflictDoNothing: vi.fn(() => Promise.resolve()),
        };
      }),
    })),

    update: vi.fn(() => ({
      set: vi.fn((vals: unknown) => {
        updatedSets.push(vals);
        return {
          where: vi.fn(() => Promise.resolve()),
        };
      }),
    })),
  };

  return tx;
}

// Helper: push call row + contact row for loadCallContact (2 queries)
function pushContact(
  tx: ReturnType<typeof buildMockTx>,
  contactId: string,
  phoneE164: string,
) {
  tx._selectQueue.push([{ contactId }], [{ phoneE164 }]);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('dispatchToolSideEffect', () => {
  const ORG_ID = 'org-1';
  const CALL_ID = 'call-1';
  const CONTACT_ID = 'contact-1';

  beforeEach(() => {
    vi.clearAllMocks();
    mockTx = buildMockTx();
  });

  // ── book_appointment ────────────────────────────────────────────────────────

  describe('book_appointment', () => {
    it('inserts appointment and sets outcome when none exists', async () => {
      // loadCallContact: 2 selects (call row + contact row)
      // check existing appointment: 1 select → empty
      pushContact(mockTx, CONTACT_ID, '+39123456789');
      mockTx._selectQueue.push([]);

      const result = await dispatchToolSideEffect(mockTx, ORG_ID, CALL_ID, 'book_appointment', {
        date: '2025-06-15',
        time: '10:30',
        contact_confirmation_text: 'Sì, confermo',
      });

      expect(mockTx.insert).toHaveBeenCalledOnce();
      const insertedRow = mockTx._insertedRows[0] as Record<string, unknown>;
      expect(insertedRow.org_id).toBe(ORG_ID);
      expect(insertedRow.call_id).toBe(CALL_ID);
      expect(insertedRow.contact_id).toBe(CONTACT_ID);
      expect(insertedRow.status).toBe('booked');

      expect(mockTx.update).toHaveBeenCalledOnce();
      const updatedSet = mockTx._updatedSets[0] as Record<string, unknown>;
      expect(updatedSet.outcome).toBe('appointment_booked');

      expect(result.inngestEvents).toHaveLength(1);
      expect(result.inngestEvents[0]!.name).toBe('appointment/booked');
      expect(result.inngestEvents[0]!.id).toBe(`appointment-booked-${CALL_ID}`);
    });

    it('is idempotent: skips insert when appointment already exists', async () => {
      pushContact(mockTx, CONTACT_ID, '+39123456789');
      mockTx._selectQueue.push([{ id: 'existing-apt-id' }]);

      const result = await dispatchToolSideEffect(mockTx, ORG_ID, CALL_ID, 'book_appointment', {
        date: '2025-06-15',
        time: '10:30',
        contact_confirmation_text: 'Sì',
      });

      expect(mockTx.insert).not.toHaveBeenCalled();
      expect(result.inngestEvents[0]?.data.appointmentId).toBe('existing-apt-id');
    });

    it('returns empty events when contact not found', async () => {
      // call row not found → loadCallContact returns null
      mockTx._selectQueue.push([]);

      const result = await dispatchToolSideEffect(mockTx, ORG_ID, CALL_ID, 'book_appointment', {
        date: '2025-06-15',
        time: '10:30',
        contact_confirmation_text: 'Sì',
      });

      expect(result.inngestEvents).toHaveLength(0);
    });
  });

  // ── mark_not_interested ─────────────────────────────────────────────────────

  describe('mark_not_interested', () => {
    it('sets outcome to not_interested', async () => {
      const result = await dispatchToolSideEffect(
        mockTx,
        ORG_ID,
        CALL_ID,
        'mark_not_interested',
        { reason: 'Ho già una macchina nuova' },
      );

      expect(mockTx.update).toHaveBeenCalledOnce();
      const updatedSet = mockTx._updatedSets[0] as Record<string, unknown>;
      expect(updatedSet.outcome).toBe('not_interested');
      expect(result.inngestEvents).toHaveLength(0);
    });

    it('works without reason arg', async () => {
      const result = await dispatchToolSideEffect(
        mockTx,
        ORG_ID,
        CALL_ID,
        'mark_not_interested',
        {},
      );
      expect(result.inngestEvents).toHaveLength(0);
      expect(mockTx.update).toHaveBeenCalledOnce();
    });
  });

  // ── mark_wrong_number ───────────────────────────────────────────────────────

  describe('mark_wrong_number', () => {
    it('sets outcome to wrong_number and flags contact metadata', async () => {
      // select for call row (to get contactId) inside runMarkWrongNumber
      mockTx._selectQueue.push([{ contactId: CONTACT_ID }]);

      const result = await dispatchToolSideEffect(
        mockTx,
        ORG_ID,
        CALL_ID,
        'mark_wrong_number',
        {},
      );

      // Two updates: calls.outcome + contacts.metadata
      expect(mockTx.update).toHaveBeenCalledTimes(2);
      const callUpdate = mockTx._updatedSets[0] as Record<string, unknown>;
      expect(callUpdate.outcome).toBe('wrong_number');
      expect(result.inngestEvents).toHaveLength(0);
    });

    it('skips contact metadata update when call row not found', async () => {
      mockTx._selectQueue.push([]);

      await dispatchToolSideEffect(mockTx, ORG_ID, CALL_ID, 'mark_wrong_number', {});

      // Only one update: the calls.outcome update
      expect(mockTx.update).toHaveBeenCalledTimes(1);
    });
  });

  // ── request_callback ────────────────────────────────────────────────────────

  describe('request_callback', () => {
    it('sets outcome to callback_requested', async () => {
      const result = await dispatchToolSideEffect(
        mockTx,
        ORG_ID,
        CALL_ID,
        'request_callback',
        { preferred_window: 'domani mattina dopo le 10' },
      );

      expect(mockTx.update).toHaveBeenCalledOnce();
      const updatedSet = mockTx._updatedSets[0] as Record<string, unknown>;
      expect(updatedSet.outcome).toBe('callback_requested');
      expect(result.inngestEvents).toHaveLength(0);
    });
  });

  // ── transfer_to_human_agent ────────────────────────────────────────────────

  describe('transfer_to_human_agent', () => {
    it('sets transferred_to_agent and emits call/transferred event', async () => {
      const result = await dispatchToolSideEffect(
        mockTx,
        ORG_ID,
        CALL_ID,
        'transfer_to_human_agent',
        { reason: 'Il cliente chiede di parlare con un operatore' },
      );

      expect(mockTx.update).toHaveBeenCalledOnce();
      const updatedSet = mockTx._updatedSets[0] as Record<string, unknown>;
      expect(updatedSet.transferred_to_agent).toBe(true);

      expect(result.inngestEvents).toHaveLength(1);
      expect(result.inngestEvents[0]!.name).toBe('call/transferred');
      expect(result.inngestEvents[0]!.id).toBe(`call-transferred-${CALL_ID}`);
      expect((result.inngestEvents[0]!.data as Record<string, unknown>).reason).toBe(
        'Il cliente chiede di parlare con un operatore',
      );
    });
  });

  // ── register_opt_out ───────────────────────────────────────────────────────

  describe('register_opt_out', () => {
    it('inserts opt-out entry, marks contact opted out, sets outcome', async () => {
      pushContact(mockTx, CONTACT_ID, '+39123456789');

      const result = await dispatchToolSideEffect(
        mockTx,
        ORG_ID,
        CALL_ID,
        'register_opt_out',
        { confirmation_text: 'Non voglio essere ricontattato' },
      );

      expect(mockTx.insert).toHaveBeenCalledOnce();
      const insertedRow = mockTx._insertedRows[0] as Record<string, unknown>;
      expect(insertedRow.org_id).toBe(ORG_ID);
      expect(insertedRow.phone_e164).toBe('+39123456789');
      expect(insertedRow.source).toBe('call_outcome');

      // Two updates: contacts.opt_out + calls.outcome
      expect(mockTx.update).toHaveBeenCalledTimes(2);
      const contactUpdate = mockTx._updatedSets[0] as Record<string, unknown>;
      expect(contactUpdate.opt_out).toBe(true);
      expect(contactUpdate.opt_out_reason).toBe('Non voglio essere ricontattato');

      const callUpdate = mockTx._updatedSets[1] as Record<string, unknown>;
      expect(callUpdate.outcome).toBe('do_not_call');

      expect(result.inngestEvents).toHaveLength(0);
    });

    it('returns empty events when contact not found', async () => {
      // call row not found → loadCallContact returns null
      mockTx._selectQueue.push([]);

      const result = await dispatchToolSideEffect(
        mockTx,
        ORG_ID,
        CALL_ID,
        'register_opt_out',
        { confirmation_text: 'Opt out' },
      );

      expect(result.inngestEvents).toHaveLength(0);
      expect(mockTx.insert).not.toHaveBeenCalled();
    });
  });

  // ── confirm_appointment ────────────────────────────────────────────────────

  describe('confirm_appointment', () => {
    it('updates appointment status to confirmed', async () => {
      const result = await dispatchToolSideEffect(
        mockTx,
        ORG_ID,
        CALL_ID,
        'confirm_appointment',
        { confirmation_text: 'Sì, ci sarò' },
      );

      expect(mockTx.update).toHaveBeenCalledOnce();
      const updatedSet = mockTx._updatedSets[0] as Record<string, unknown>;
      expect(updatedSet.status).toBe('confirmed');
      expect(result.inngestEvents).toHaveLength(0);
    });
  });

  // ── reschedule_appointment ─────────────────────────────────────────────────

  describe('reschedule_appointment', () => {
    it('updates appointment scheduled_at and resets status to booked', async () => {
      const result = await dispatchToolSideEffect(
        mockTx,
        ORG_ID,
        CALL_ID,
        'reschedule_appointment',
        { new_date: '2025-07-01', new_time: '14:00', contact_confirmation_text: 'Sì, va bene' },
      );

      expect(mockTx.update).toHaveBeenCalledOnce();
      const updatedSet = mockTx._updatedSets[0] as Record<string, unknown>;
      expect(updatedSet.status).toBe('booked');
      expect(updatedSet.scheduled_at).toBeInstanceOf(Date);
      expect(result.inngestEvents).toHaveLength(0);
    });
  });

  // ── submit_survey_response ─────────────────────────────────────────────────

  describe('submit_survey_response', () => {
    it('sets outcome to interested', async () => {
      const result = await dispatchToolSideEffect(
        mockTx,
        ORG_ID,
        CALL_ID,
        'submit_survey_response',
        { overall_satisfaction: 9, would_recommend: true },
      );

      expect(mockTx.update).toHaveBeenCalledOnce();
      const updatedSet = mockTx._updatedSets[0] as Record<string, unknown>;
      expect(updatedSet.outcome).toBe('interested');
      expect(result.inngestEvents).toHaveLength(0);
    });
  });

  // ── unknown tool ──────────────────────────────────────────────────────────

  describe('unknown tool', () => {
    it('returns no events and performs no DB writes', async () => {
      const result = await dispatchToolSideEffect(
        mockTx,
        ORG_ID,
        CALL_ID,
        'nonexistent_tool',
        {},
      );

      expect(result.inngestEvents).toHaveLength(0);
      expect(mockTx.insert).not.toHaveBeenCalled();
      expect(mockTx.update).not.toHaveBeenCalled();
    });
  });
});
