import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRecordAudit = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/db/audit', () => ({
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
  withSystemContext: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
}));

const mockCreateCall = vi.fn().mockResolvedValue({ providerCallId: 'vapi-call-xyz' });
vi.mock('@/lib/voice/factory', () => ({
  getVoiceProvider: vi.fn(() => ({
    name: 'vapi',
    createCall: mockCreateCall,
  })),
}));

const mockChargeForCall = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/services/credit', () => ({
  chargeForCall: (...args: unknown[]) => mockChargeForCall(...args),
}));

const mockComputePerMinuteCents = vi.fn().mockResolvedValue(100);
const mockComputeCallCost = vi.fn().mockReturnValue({ billableSeconds: 60, costCents: 200 });
vi.mock('@/lib/services/billing-rules', () => ({
  computePerMinuteCents: (...args: unknown[]) => mockComputePerMinuteCents(...args),
  computeCallCost: (...args: unknown[]) => mockComputeCallCost(...args),
}));

const mockSendInngestEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: (...args: unknown[]) => mockSendInngestEvent(...args),
}));

const mockApplyDispatchJitter = vi.fn().mockResolvedValue(0);
vi.mock('@/lib/voice/cli/jitter', () => ({
  applyDispatchJitter: (...args: unknown[]) => mockApplyDispatchJitter(...args),
}));

const mockIsSbcUnhealthy = vi.fn().mockResolvedValue(false);
const mockRecordSbcDispatchFailure = vi.fn().mockResolvedValue(undefined);
const mockRecordSbcDispatchSuccess = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/services/system_flags', () => ({
  isSbcUnhealthy: (...args: unknown[]) => mockIsSbcUnhealthy(...args),
  recordSbcDispatchFailure: (...args: unknown[]) => mockRecordSbcDispatchFailure(...args),
  recordSbcDispatchSuccess: (...args: unknown[]) => mockRecordSbcDispatchSuccess(...args),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue(
    'Buongiorno, sono {{salesperson_first_name}}, un assistente vocale automatico per {{dealership_name}}, concessionario {{brand}}.',
  ),
}));

vi.mock('@/lib/env', () => ({
  env: {
    VOICE_PROVIDER: 'vapi',
    VAPI_API_KEY: 'test-api-key',
    VAPI_ASSISTANT_ID: 'test-assistant-id',
    VAPI_WEBHOOK_SECRET: 'test-webhook-secret',
    INNGEST_EVENT_KEY: 'test-event-key',
    NEXT_PUBLIC_APP_URL: 'https://app.example.com',
  },
}));

// ─── Mock transaction helpers ──────────────────────────────────────────────────

const selectResultQueue: unknown[][] = [];
const insertResultQueue: unknown[][] = [];
const updateResultQueue: unknown[][] = [];

function makeSelectChain(result: unknown[]): unknown {
  const thenable = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(result)),
    from: vi.fn(() => thenable),
    where: vi.fn(() => thenable),
    orderBy: vi.fn(() => thenable),
    limit: vi.fn(() => Promise.resolve(result)),
    for: vi.fn(() => thenable),
  };
  return thenable;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockTx: any = {
  select: vi.fn(() => {
    const result = selectResultQueue.shift() ?? [];
    return makeSelectChain(result);
  }),
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(() => Promise.resolve(insertResultQueue.shift() ?? [])),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(updateResultQueue.shift() ?? [])),
    })),
  })),
  execute: vi.fn().mockResolvedValue(undefined),
};

const { withOrgContext, withSystemContext } = await import('@/lib/db/context');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID = 'org-1';
const CALL_ID = 'call-1';
const CAMPAIGN_ID = 'campaign-1';
const SCRIPT_ID = 'script-1';
const TEMPLATE_ID = 'template-1';
const CONTACT_ID = 'contact-1';

const fakeCall = {
  id: CALL_ID,
  org_id: ORG_ID,
  campaign_id: CAMPAIGN_ID,
  contact_id: CONTACT_ID,
  provider: 'vapi' as const,
  provider_call_id: null,
  status: 'pending' as const,
  outcome: null,
  outcome_confidence: null,
  billable_seconds: null,
  cost_cents: null,
  recording_path: null,
  transcript_path: null,
  transferred_to_agent: false,
  error_code: null,
  started_at: null,
  ended_at: null,
  created_at: new Date('2026-01-01'),
};

const fakeCampaign = {
  id: CAMPAIGN_ID,
  org_id: ORG_ID,
  script_id: SCRIPT_ID,
  contact_list_id: 'list-1',
  name: 'Test Campaign',
  status: 'running' as const,
  concurrency_limit: 5,
  time_window_start: '09:00',
  time_window_end: '19:00',
  scheduled_at: null,
  started_at: null,
  completed_at: null,
  estimated_max_cents: null,
  actual_cents: 0,
  created_at: new Date(),
  updated_at: new Date(),
};

const fakeScript = {
  id: SCRIPT_ID,
  org_id: ORG_ID,
  template_id: TEMPLATE_ID,
  name: 'Lead Reactivation Script',
  variables: {
    dealership_name: 'AutoRoma',
    brand: 'Volkswagen',
    salesperson_first_name: 'Luca',
    available_slots: ['15/06 10:00', '16/06 14:00'],
    lead_origin_context: 'Interesse Golf GTI',
  },
  voice_id: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const fakeTemplate = {
  id: TEMPLATE_ID,
  slug: 'lead-reactivation',
  name: 'Riattivazione Lead',
  version: 1,
  system_prompt:
    'Sei {{salesperson_first_name}} per {{dealership_name}}, concessionario {{brand}}.',
  variable_schema: {},
  default_voice_id: 'EXAVITQu4vr4xnSDxMaL',
  default_language: 'it-IT',
  published_at: new Date('2024-01-01'),
  created_at: new Date('2024-01-01'),
  updated_at: new Date('2024-01-01'),
};

const fakeContact = {
  id: CONTACT_ID,
  org_id: ORG_ID,
  contact_list_id: 'list-1',
  phone_e164: '+393331234567',
  first_name: 'Mario',
  last_name: 'Rossi',
  email: null,
  consent_basis: 'consent' as const,
  consent_evidence: null,
  contact_type: 'b2c' as const,
  rpo_status: 'unchecked' as const,
  opt_out: false,
  opt_out_reason: null,
  metadata: null,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
};

const fakePhone = { e164: '+390212345678', provider: 'voiped' as const };

beforeEach(() => {
  selectResultQueue.length = 0;
  insertResultQueue.length = 0;
  updateResultQueue.length = 0;
  vi.clearAllMocks();
  // Restore mock defaults after clearAllMocks
  mockRecordAudit.mockResolvedValue(undefined);
  mockCreateCall.mockResolvedValue({ providerCallId: 'vapi-call-xyz' });
  mockChargeForCall.mockResolvedValue(undefined);
  mockComputePerMinuteCents.mockResolvedValue(100);
  mockComputeCallCost.mockReturnValue({ billableSeconds: 60, costCents: 200 });
  mockSendInngestEvent.mockResolvedValue(undefined);
  mockApplyDispatchJitter.mockResolvedValue(0);
  mockIsSbcUnhealthy.mockResolvedValue(false);
  mockRecordSbcDispatchFailure.mockResolvedValue(undefined);
  mockRecordSbcDispatchSuccess.mockResolvedValue(undefined);
});

// ─── createPendingCall ────────────────────────────────────────────────────────

describe('createPendingCall', () => {
  it('inserts a pending call and records audit', async () => {
    const expected = { ...fakeCall, id: 'new-call-id' };
    insertResultQueue.push([expected]);

    const { createPendingCall } = await import('./calls');
    const result = await createPendingCall(ORG_ID, {
      org_id: ORG_ID,
      campaign_id: CAMPAIGN_ID,
      contact_id: CONTACT_ID,
      provider: 'vapi',
    });

    expect(result.id).toBe('new-call-id');
    expect(result.status).toBe('pending');
    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ action: 'call.created', subjectType: 'call' }),
    );
    expect(withOrgContext).toHaveBeenCalledWith(ORG_ID, expect.any(Function));
  });
});

// ─── dispatchCall ─────────────────────────────────────────────────────────────

describe('dispatchCall', () => {
  function queueDispatchSelectResults() {
    selectResultQueue.push(
      [fakeCall],      // call
      [fakeCampaign],  // campaign
      [fakeScript],    // script
      [fakeTemplate],  // template
      [fakeContact],   // contact
      [fakePhone],     // phone number
    );
  }

  it('applies anti-spam jitter before invoking the provider createCall', async () => {
    queueDispatchSelectResults();
    let jitterFiredBeforeCreateCall = false;
    mockApplyDispatchJitter.mockImplementationOnce(async () => {
      jitterFiredBeforeCreateCall = mockCreateCall.mock.calls.length === 0;
      return 0;
    });

    const { dispatchCall } = await import('./calls');
    await dispatchCall(ORG_ID, CALL_ID);

    expect(mockApplyDispatchJitter).toHaveBeenCalledOnce();
    expect(jitterFiredBeforeCreateCall).toBe(true);
  });

  it('dispatches call and transitions to dialing', async () => {
    queueDispatchSelectResults();

    const { dispatchCall } = await import('./calls');
    await dispatchCall(ORG_ID, CALL_ID);

    expect(mockCreateCall).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (mockCreateCall.mock.calls[0] as any[])[0] as Record<string, unknown>;
    expect(callArgs.toNumber).toBe('+393331234567');
    expect(callArgs.fromNumber).toBe('+390212345678');
    expect(callArgs.language).toBe('it-IT');
    expect(callArgs.amdEnabled).toBe(true);
    expect(callArgs.recordingEnabled).toBe(true);
    expect((callArgs.endCallFunctions as unknown[]).length).toBeGreaterThan(0);
    expect(callArgs.metadata).toMatchObject({ orgId: ORG_ID, callId: CALL_ID });

    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ action: 'call.dispatched', subjectId: CALL_ID }),
    );
  });

  it('uses template default_voice_id when script has no voice_id override', async () => {
    queueDispatchSelectResults();

    const { dispatchCall } = await import('./calls');
    await dispatchCall(ORG_ID, CALL_ID);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (mockCreateCall.mock.calls[0] as any[])[0] as Record<string, unknown>;
    expect(callArgs.voiceId).toBe('EXAVITQu4vr4xnSDxMaL');
  });

  it('uses script voice_id override when present', async () => {
    const scriptWithVoice = { ...fakeScript, voice_id: 'custom-voice-id' };
    selectResultQueue.push(
      [fakeCall],
      [fakeCampaign],
      [scriptWithVoice],
      [fakeTemplate],
      [fakeContact],
      [fakePhone],
    );

    const { dispatchCall } = await import('./calls');
    await dispatchCall(ORG_ID, CALL_ID);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (mockCreateCall.mock.calls[0] as any[])[0] as Record<string, unknown>;
    expect(callArgs.voiceId).toBe('custom-voice-id');
  });

  it('includes the correct webhook URL', async () => {
    queueDispatchSelectResults();

    const { dispatchCall } = await import('./calls');
    await dispatchCall(ORG_ID, CALL_ID);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (mockCreateCall.mock.calls[0] as any[])[0] as Record<string, unknown>;
    expect(callArgs.webhookUrl).toBe('https://app.example.com/api/webhooks/vapi');
  });

  it('throws NoPhoneNumberAvailableError when no phone found', async () => {
    selectResultQueue.push(
      [fakeCall],
      [fakeCampaign],
      [fakeScript],
      [fakeTemplate],
      [fakeContact],
      [], // no phone number
    );

    const { dispatchCall, NoPhoneNumberAvailableError } = await import('./calls');
    await expect(dispatchCall(ORG_ID, CALL_ID)).rejects.toThrow(NoPhoneNumberAvailableError);
  });

  it('throws if call not found', async () => {
    selectResultQueue.push([]); // no call

    const { dispatchCall } = await import('./calls');
    await expect(dispatchCall(ORG_ID, CALL_ID)).rejects.toThrow('call_not_found');
  });

  it('assembles system prompt with AI Act preamble', async () => {
    queueDispatchSelectResults();

    const { dispatchCall } = await import('./calls');
    await dispatchCall(ORG_ID, CALL_ID);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (mockCreateCall.mock.calls[0] as any[])[0] as Record<string, unknown>;
    expect(callArgs.systemPrompt).toContain('assistente vocale automatico');
    expect(callArgs.systemPrompt).toContain('AutoRoma');
    expect(callArgs.systemPrompt).toContain('Volkswagen');
  });

  it('does not pass voicemailMessage when leave_voicemail_message is false (default)', async () => {
    queueDispatchSelectResults();

    const { dispatchCall } = await import('./calls');
    await dispatchCall(ORG_ID, CALL_ID);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (mockCreateCall.mock.calls[0] as any[])[0] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty('voicemailMessage');
  });

  it('records an SBC dispatch failure on createCall error from a voiped CLI', async () => {
    queueDispatchSelectResults();
    const sentinel = new Error('vapi 502: trunk down');
    mockCreateCall.mockRejectedValueOnce(sentinel);

    const { dispatchCall } = await import('./calls');
    await expect(dispatchCall(ORG_ID, CALL_ID)).rejects.toThrow(sentinel);

    expect(mockRecordSbcDispatchFailure).toHaveBeenCalledWith(
      'vapi 502: trunk down',
    );
  });

  it('records an SBC dispatch success when createCall succeeds from a voiped CLI', async () => {
    queueDispatchSelectResults();

    const { dispatchCall } = await import('./calls');
    await dispatchCall(ORG_ID, CALL_ID);

    expect(mockRecordSbcDispatchSuccess).toHaveBeenCalled();
  });

  it('does not record SBC tracking for a Twilio CLI', async () => {
    selectResultQueue.push(
      [fakeCall],
      [fakeCampaign],
      [fakeScript],
      [fakeTemplate],
      [fakeContact],
      [{ e164: '+390277770011', provider: 'twilio' as const }],
    );

    const { dispatchCall } = await import('./calls');
    await dispatchCall(ORG_ID, CALL_ID);

    expect(mockRecordSbcDispatchFailure).not.toHaveBeenCalled();
    expect(mockRecordSbcDispatchSuccess).not.toHaveBeenCalled();
  });

  it('restricts the phone-number SELECT to twilio when sbc_unhealthy is true', async () => {
    mockIsSbcUnhealthy.mockResolvedValueOnce(true);
    selectResultQueue.push(
      [fakeCall],
      [fakeCampaign],
      [fakeScript],
      [fakeTemplate],
      [fakeContact],
      [{ e164: '+390277770011', provider: 'twilio' as const }],
    );

    const { dispatchCall } = await import('./calls');
    await dispatchCall(ORG_ID, CALL_ID);

    // The selected fromNumber is the Twilio CLI, not the seeded Voiped one.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (mockCreateCall.mock.calls[0] as any[])[0] as Record<string, unknown>;
    expect(callArgs.fromNumber).toBe('+390277770011');
    // SBC tracking is skipped because the picked CLI is Twilio.
    expect(mockRecordSbcDispatchSuccess).not.toHaveBeenCalled();
  });

  it('passes voicemailMessage when leave_voicemail_message=true in script variables', async () => {
    const scriptWithVoicemail = {
      ...fakeScript,
      variables: { ...fakeScript.variables, leave_voicemail_message: true },
    };
    selectResultQueue.push(
      [fakeCall],
      [fakeCampaign],
      [scriptWithVoicemail],
      [fakeTemplate],
      [fakeContact],
      [fakePhone],
    );

    const { dispatchCall } = await import('./calls');
    await dispatchCall(ORG_ID, CALL_ID);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (mockCreateCall.mock.calls[0] as any[])[0] as Record<string, unknown>;
    expect(typeof callArgs['voicemailMessage']).toBe('string');
    expect((callArgs['voicemailMessage'] as string).length).toBeGreaterThan(0);
  });
});

// ─── recordCallStarted ────────────────────────────────────────────────────────

describe('recordCallStarted', () => {
  it('transitions pending call to in_progress', async () => {
    selectResultQueue.push([{ org_id: ORG_ID }]);

    const { recordCallStarted } = await import('./calls');
    await recordCallStarted(CALL_ID, 'event-abc');

    expect(mockTx.update).toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ action: 'call.started' }),
    );
  });

  it('is a no-op when call not found', async () => {
    selectResultQueue.push([]); // no call

    const { recordCallStarted } = await import('./calls');
    await expect(recordCallStarted(CALL_ID, 'event-abc')).resolves.toBeUndefined();
    expect(mockTx.update).not.toHaveBeenCalled();
  });
});

// ─── recordCallEnded ──────────────────────────────────────────────────────────

describe('recordCallEnded', () => {
  it('updates call status, computes billing, charges credits, emits event', async () => {
    selectResultQueue.push([{ org_id: ORG_ID, metadata: null }]);

    const { recordCallEnded, CALL_COMPLETED_EVENT } = await import('./calls');
    await recordCallEnded(CALL_ID, {
      durationSeconds: 90,
      endedReason: 'assistant-ended-call',
    });

    expect(mockComputeCallCost).toHaveBeenCalledWith({
      durationSeconds: 90,
      perMinuteCents: 100,
    });
    expect(mockChargeForCall).toHaveBeenCalledWith(ORG_ID, CALL_ID, 200);
    expect(mockSendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: CALL_COMPLETED_EVENT }),
    );
  });

  it('maps "voicemail" endedReason to voicemail status', async () => {
    selectResultQueue.push([{ org_id: ORG_ID, metadata: null }]);

    const { recordCallEnded } = await import('./calls');
    await recordCallEnded(CALL_ID, { durationSeconds: 10, endedReason: 'voicemail' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setArgs = (mockTx.update.mock.results[0] as any).value.set.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.status).toBe('voicemail');
  });

  it('sets outcome=voicemail_no_message when voicemail detected and leave_voicemail_message=false', async () => {
    selectResultQueue.push([{ org_id: ORG_ID, metadata: { leave_voicemail_message: false } }]);

    const { recordCallEnded } = await import('./calls');
    await recordCallEnded(CALL_ID, { durationSeconds: 5, endedReason: 'voicemail' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setArgs = (mockTx.update.mock.results[0] as any).value.set.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.status).toBe('voicemail');
    expect(setArgs.outcome).toBe('voicemail_no_message');
  });

  it('sets outcome=voicemail_left when voicemail detected and leave_voicemail_message=true', async () => {
    selectResultQueue.push([{ org_id: ORG_ID, metadata: { leave_voicemail_message: true } }]);

    const { recordCallEnded } = await import('./calls');
    await recordCallEnded(CALL_ID, { durationSeconds: 15, endedReason: 'voicemail' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setArgs = (mockTx.update.mock.results[0] as any).value.set.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.status).toBe('voicemail');
    expect(setArgs.outcome).toBe('voicemail_left');
  });

  it('does not set outcome for non-voicemail end reasons', async () => {
    selectResultQueue.push([{ org_id: ORG_ID, metadata: null }]);

    const { recordCallEnded } = await import('./calls');
    await recordCallEnded(CALL_ID, { durationSeconds: 90, endedReason: 'assistant-ended-call' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setArgs = (mockTx.update.mock.results[0] as any).value.set.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs).not.toHaveProperty('outcome');
  });

  it('maps "no-answer" endedReason to no_answer status', async () => {
    selectResultQueue.push([{ org_id: ORG_ID, metadata: null }]);

    const { recordCallEnded } = await import('./calls');
    await recordCallEnded(CALL_ID, { durationSeconds: 5, endedReason: 'no-answer' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setArgs = (mockTx.update.mock.results[0] as any).value.set.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.status).toBe('no_answer');
  });

  it('does not charge when costCents is 0', async () => {
    selectResultQueue.push([{ org_id: ORG_ID, metadata: null }]);
    mockComputeCallCost.mockReturnValueOnce({ billableSeconds: 0, costCents: 0 });

    const { recordCallEnded } = await import('./calls');
    await recordCallEnded(CALL_ID, { durationSeconds: 3, endedReason: 'no-answer' });

    expect(mockChargeForCall).not.toHaveBeenCalled();
    // But still emits the completed event
    expect(mockSendInngestEvent).toHaveBeenCalled();
  });

  it('is a no-op when call not found', async () => {
    selectResultQueue.push([]); // no call

    const { recordCallEnded } = await import('./calls');
    await expect(
      recordCallEnded(CALL_ID, { durationSeconds: 60, endedReason: 'assistant-ended-call' }),
    ).resolves.toBeUndefined();
    expect(mockChargeForCall).not.toHaveBeenCalled();
  });
});

// ─── recordToolInvocation ─────────────────────────────────────────────────────

describe('recordToolInvocation', () => {
  it('records a tool invocation in the audit log', async () => {
    selectResultQueue.push([{ org_id: ORG_ID }]);

    const { recordToolInvocation } = await import('./calls');
    await recordToolInvocation(CALL_ID, 'book_appointment', { date: '2026-06-15', time: '10:00' });

    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        action: 'call.tool_invoked',
        subjectId: CALL_ID,
        metadata: expect.objectContaining({ tool: 'book_appointment' }),
      }),
    );
  });

  it('is a no-op when call not found', async () => {
    selectResultQueue.push([]); // no call

    const { recordToolInvocation } = await import('./calls');
    await expect(recordToolInvocation(CALL_ID, 'book_appointment', {})).resolves.toBeUndefined();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});

// ─── classifyAndFinaliseCall ──────────────────────────────────────────────────

describe('classifyAndFinaliseCall', () => {
  it('emits classify event when no outcome set', async () => {
    selectResultQueue.push([{ org_id: ORG_ID, outcome: null }]);

    const { classifyAndFinaliseCall, CALL_CLASSIFY_EVENT } = await import('./calls');
    await classifyAndFinaliseCall(CALL_ID);

    expect(mockSendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: CALL_CLASSIFY_EVENT, data: expect.objectContaining({ callId: CALL_ID }) }),
    );
  });

  it('skips classify event when outcome already set by a tool', async () => {
    selectResultQueue.push([{ org_id: ORG_ID, outcome: 'appointment_booked' }]);

    const { classifyAndFinaliseCall } = await import('./calls');
    await classifyAndFinaliseCall(CALL_ID);

    expect(mockSendInngestEvent).not.toHaveBeenCalled();
  });

  it('is a no-op when call not found', async () => {
    selectResultQueue.push([]); // no call

    const { classifyAndFinaliseCall } = await import('./calls');
    await expect(classifyAndFinaliseCall(CALL_ID)).resolves.toBeUndefined();
    expect(mockSendInngestEvent).not.toHaveBeenCalled();
  });
});

// ─── fetchCallTimeline ────────────────────────────────────────────────────────

describe('fetchCallTimeline', () => {
  it('returns call with events from audit log', async () => {
    const fakeEvent = {
      type: 'call.started',
      timestamp: new Date('2026-01-01T10:00:00Z'),
      data: { providerEventId: 'evt-1' },
    };
    selectResultQueue.push([fakeCall], [fakeEvent]);

    const { fetchCallTimeline } = await import('./calls');
    const result = await fetchCallTimeline(ORG_ID, CALL_ID);

    expect(result).not.toBeNull();
    expect(result!.call.id).toBe(CALL_ID);
    expect(result!.events).toHaveLength(1);
    expect(result!.events[0]!.type).toBe('call.started');
  });

  it('returns null when call not found', async () => {
    selectResultQueue.push([]); // no call

    const { fetchCallTimeline } = await import('./calls');
    const result = await fetchCallTimeline(ORG_ID, CALL_ID);

    expect(result).toBeNull();
  });

  it('returns call with empty events when no audit entries exist', async () => {
    selectResultQueue.push([fakeCall], []);

    const { fetchCallTimeline } = await import('./calls');
    const result = await fetchCallTimeline(ORG_ID, CALL_ID);

    expect(result).not.toBeNull();
    expect(result!.events).toHaveLength(0);
  });
});
