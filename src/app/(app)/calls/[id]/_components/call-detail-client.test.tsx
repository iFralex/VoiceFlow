import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRefresh = vi.fn();
const mockRefundCallAction = vi.fn();
const mockReportCallIssueAction = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/actions/calls', () => ({
  refundCallAction: (...args: unknown[]) => mockRefundCallAction(...args),
  reportCallIssueAction: (...args: unknown[]) => mockReportCallIssueAction(...args),
}));

import type {
  SerializedCallDetail,
} from '@/app/(app)/calls/[id]/_components/call-detail-client';
import { CallDetailClient } from '@/app/(app)/calls/[id]/_components/call-detail-client';

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: function play(this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: false });
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: function pause(this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: true });
      this.dispatchEvent(new Event('pause'));
    },
  });
});

afterEach(cleanup);
beforeEach(() => {
  mockRefresh.mockClear();
  mockRefundCallAction.mockReset();
  mockReportCallIssueAction.mockReset();
});

function makeCall(overrides: Partial<SerializedCallDetail> = {}): SerializedCallDetail {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'completed',
    outcome: 'appointment_booked',
    direction: 'outbound',
    contactName: 'Mario Rossi',
    contactPhone: '+393331234567',
    campaignId: 'camp-1',
    campaignName: 'Riattivazione',
    scriptName: 'Lead Reactivation',
    startedAt: '2026-05-09T10:00:00.000Z',
    endedAt: '2026-05-09T10:02:00.000Z',
    createdAt: '2026-05-09T09:59:00.000Z',
    billableSeconds: 120,
    costCents: 130,
    metadata: { foo: 'bar' },
    recordingUrl: 'https://example.test/audio.mp3',
    recordingAvailable: true,
    transcript: [
      { speaker: 'agent', text: 'Buongiorno', startMs: 0, endMs: 1500 },
      { speaker: 'caller', text: 'Pronto', startMs: 1500, endMs: 3000 },
    ],
    transcriptAvailable: true,
    timelineEvents: [
      {
        type: 'call.created',
        timestamp: '2026-05-09T09:59:00.000Z',
        data: {},
      },
      {
        type: 'call.tool_invoked',
        timestamp: '2026-05-09T10:01:00.000Z',
        data: { tool: 'book_appointment' },
      },
      {
        type: 'call.ended',
        timestamp: '2026-05-09T10:02:00.000Z',
        data: { endedReason: 'completed' },
      },
    ],
    auditEntries: [
      {
        id: '1',
        actorUserId: null,
        actorType: 'webhook',
        action: 'call.ended',
        metadata: { endedReason: 'completed' },
        createdAt: '2026-05-09T10:02:00.000Z',
      },
    ],
    canRefund: true,
    canReport: true,
    ...overrides,
  };
}

describe('CallDetailClient', () => {
  it('renders the contact header, KPIs, and timeline', () => {
    render(<CallDetailClient call={makeCall()} />);
    expect(screen.getByText('Mario Rossi')).toBeInTheDocument();
    expect(screen.getAllByText(/Riattivazione/)[0]).toBeInTheDocument();
    expect(screen.getByText('Inizio chiamata')).toBeInTheDocument();
    expect(screen.getByText('2m 0s')).toBeInTheDocument();
    // Currency formatting depends on the runtime ICU build; we just assert the
    // value is rendered alongside the EUR symbol regardless of separator/order.
    expect(screen.getByText(/€/)).toBeInTheDocument();
    expect(screen.getByText('In uscita')).toBeInTheDocument();
    expect(screen.getByText('Chiamata creata')).toBeInTheDocument();
    expect(screen.getByText('Strumento invocato')).toBeInTheDocument();
    expect(screen.getByText('Strumento: book_appointment')).toBeInTheDocument();
  });

  it('renders the recording player when both recording and transcript are available', () => {
    render(<CallDetailClient call={makeCall()} />);
    expect(screen.getByText('Buongiorno')).toBeInTheDocument();
    expect(screen.getByLabelText('Registrazione della chiamata')).toBeInTheDocument();
  });

  it('shows the processing placeholder when the recording is missing', () => {
    render(
      <CallDetailClient
        call={makeCall({
          recordingUrl: null,
          recordingAvailable: false,
          transcriptAvailable: false,
          transcript: [],
        })}
      />,
    );
    const placeholder = document.querySelector('[data-slot="processing-placeholder"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.getAttribute('data-kind')).toBe('recording');
    expect(screen.getByText(/Registrazione in elaborazione/)).toBeInTheDocument();
  });

  it('hides destructive actions when capabilities are missing', () => {
    render(
      <CallDetailClient call={makeCall({ canRefund: false, canReport: false })} />,
    );
    expect(screen.queryByText('Rimborsa chiamata')).toBeNull();
    expect(screen.queryByText('Segnala problema')).toBeNull();
  });

  it('hides the refund button when the call has no cost', () => {
    render(<CallDetailClient call={makeCall({ costCents: null })} />);
    expect(screen.queryByText('Rimborsa chiamata')).toBeNull();
    // Report stays available regardless of cost.
    expect(screen.getByText('Segnala problema')).toBeInTheDocument();
  });

  it('renders an audit entry when audit capability is granted', async () => {
    const user = userEvent.setup();
    render(<CallDetailClient call={makeCall()} />);
    await user.click(screen.getByRole('tab', { name: 'Audit' }));
    const auditEntries = document.querySelectorAll(
      '[data-slot="call-audit-entry"]',
    );
    expect(auditEntries.length).toBe(1);
    expect(auditEntries[0]?.getAttribute('data-action')).toBe('call.ended');
  });

  it('shows the audit-forbidden message when the audit slice is null', async () => {
    const user = userEvent.setup();
    render(<CallDetailClient call={makeCall({ auditEntries: null })} />);
    await user.click(screen.getByRole('tab', { name: 'Audit' }));
    expect(
      screen.getByText(/Non hai i permessi per visualizzare l'audit log/),
    ).toBeInTheDocument();
  });
});
